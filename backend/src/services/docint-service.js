const { createDocumentIntelligenceClient } = require('../clients');

class DocumentIntelligenceService {
  constructor() {
    this.client = null;
  }

  async _getClient() {
    if (!this.client) {
      this.client = createDocumentIntelligenceClient();
    }
    return this.client;
  }

  _selectModel(mimeType) {
    // Select appropriate model based on document type
    const modelMap = {
      'application/pdf': 'prebuilt-layout',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'prebuilt-layout',
      'application/msword': 'prebuilt-layout',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'prebuilt-layout',
      'application/vnd.ms-powerpoint': 'prebuilt-layout',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'prebuilt-layout',
      'application/vnd.ms-excel': 'prebuilt-layout',
    };

    return modelMap[mimeType] || 'prebuilt-document';
  }

  async analyzeDocument(blobUrl, options = {}) {
    const client = await this._getClient();
    const modelId = options.modelId || this._selectModel(options.mimeType);

    const poller = await client.beginAnalyzeDocumentFromUrl(modelId, blobUrl);
    const result = await poller.pollUntilDone();

    return this._normalizeResult(result, options);
  }

  _normalizeResult(result, options = {}) {
    const normalized = {
      content: result.content || '',
      pages: [],
      tables: [],
      paragraphs: [],
      sections: [],
      keyValuePairs: [],
      figures: [],
      metadata: {
        pageCount: result.pages?.length || 0,
        modelId: result.modelId,
        apiVersion: result.apiVersion,
      },
    };

    // Extract pages
    if (result.pages) {
      normalized.pages = result.pages.map((page, index) => ({
        pageNumber: index + 1,
        width: page.width,
        height: page.height,
        unit: page.unit,
        lines: page.lines?.map((line) => ({
          content: line.content,
          boundingBox: line.polygon,
        })) || [],
        words: page.words?.length || 0,
      }));
    }

    // Extract tables
    if (result.tables) {
      normalized.tables = result.tables.map((table, index) => ({
        tableIndex: index,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        cells: table.cells?.map((cell) => ({
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          content: cell.content,
          rowSpan: cell.rowSpan || 1,
          columnSpan: cell.columnSpan || 1,
          isHeader: cell.kind === 'columnHeader' || cell.kind === 'rowHeader',
        })) || [],
        boundingRegions: table.boundingRegions?.map((r) => ({
          pageNumber: r.pageNumber,
          boundingBox: r.polygon,
        })) || [],
      }));
    }

    // Extract paragraphs
    if (result.paragraphs) {
      normalized.paragraphs = result.paragraphs.map((para) => ({
        content: para.content,
        role: para.role,
        boundingRegions: para.boundingRegions?.map((r) => ({
          pageNumber: r.pageNumber,
          boundingBox: r.polygon,
        })) || [],
      }));
    }

    // Extract key-value pairs
    if (result.keyValuePairs) {
      normalized.keyValuePairs = result.keyValuePairs.map((kv) => ({
        key: kv.key?.content || '',
        value: kv.value?.content || '',
        confidence: kv.confidence,
      }));
    }

    // Extract figures/images
    if (result.figures) {
      normalized.figures = result.figures.map((figure) => ({
        id: figure.id,
        caption: figure.caption?.content,
        boundingBox: figure.boundingRegions?.[0]?.polygon,
        pageNumber: figure.boundingRegions?.[0]?.pageNumber || 1,
        elements: figure.elements || [],
      }));
    }

    // Build section hierarchy from paragraphs with roles
    normalized.sections = this._buildSectionHierarchy(result.paragraphs || []);

    return normalized;
  }

  _buildSectionHierarchy(paragraphs) {
    const sections = [];
    let currentSection = null;

    for (const para of paragraphs) {
      if (para.role === 'title' || para.role === 'sectionHeading') {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: para.content,
          level: para.role === 'title' ? 1 : 2,
          content: [],
          pageNumber: para.boundingRegions?.[0]?.pageNumber || 1,
        };
      } else if (currentSection) {
        currentSection.content.push(para.content);
      } else {
        // Content before any section heading
        if (!sections.length || sections[sections.length - 1].title !== 'Introduction') {
          sections.push({
            title: 'Introduction',
            level: 1,
            content: [para.content],
            pageNumber: para.boundingRegions?.[0]?.pageNumber || 1,
          });
        } else {
          sections[sections.length - 1].content.push(para.content);
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }

  extractTextWithMetadata(normalizedResult) {
    const chunks = [];

    // Add full content as first chunk
    if (normalizedResult.content) {
      chunks.push({
        content: normalizedResult.content,
        type: 'full_content',
        metadata: {
          pageCount: normalizedResult.metadata.pageCount,
        },
      });
    }

    // Add sections as separate chunks
    for (const section of normalizedResult.sections) {
      if (section.content.length > 0) {
        chunks.push({
          content: section.content.join('\n\n'),
          type: 'section',
          metadata: {
            sectionTitle: section.title,
            sectionLevel: section.level,
            pageNumber: section.pageNumber,
          },
        });
      }
    }

    // Add tables as structured chunks
    for (const table of normalizedResult.tables) {
      const tableContent = this._formatTableAsText(table);
      chunks.push({
        content: tableContent,
        type: 'table',
        metadata: {
          tableIndex: table.tableIndex,
          rowCount: table.rowCount,
          columnCount: table.columnCount,
          pageNumber: table.boundingRegions?.[0]?.pageNumber || 1,
        },
      });
    }

    return chunks;
  }

  _formatTableAsText(table) {
    if (!table.cells || table.cells.length === 0) {
      return '';
    }

    // Build a 2D array for the table
    const grid = Array.from({ length: table.rowCount }, () =>
      Array.from({ length: table.columnCount }, () => '')
    );

    for (const cell of table.cells) {
      grid[cell.rowIndex][cell.columnIndex] = cell.content;
    }

    // Format as markdown-style table
    const lines = [];
    for (let i = 0; i < grid.length; i++) {
      lines.push(`| ${grid[i].join(' | ')} |`);
      if (i === 0) {
        lines.push(`| ${grid[i].map(() => '---').join(' | ')} |`);
      }
    }

    return lines.join('\n');
  }
}

// Singleton instance
let instance = null;

function getDocumentIntelligenceService() {
  if (!instance) {
    instance = new DocumentIntelligenceService();
  }
  return instance;
}

module.exports = {
  DocumentIntelligenceService,
  getDocumentIntelligenceService,
};

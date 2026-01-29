import { create } from 'zustand';
import { Community, CommunityMember } from '@/components/CommunityVisualization';

export type CommunityColorMode = 'community' | 'entityType';
export type CommunityLayoutType = 'cose' | 'circle' | 'concentric';

interface CommunityState {
  // Selection
  selectedCommunityId: string | number | null;
  selectedCommunity: Community | null;
  selectedMember: CommunityMember | null;

  // Panel visibility
  isPanelOpen: boolean;
  isControlsCollapsed: boolean;

  // View options
  showLabels: boolean;
  colorMode: CommunityColorMode;
  currentLayout: CommunityLayoutType;

  // Highlighting
  highlightedCommunityId: string | number | null;

  // Keyboard navigation
  focusedCommunityIndex: number;

  // Actions
  selectCommunity: (community: Community | null) => void;
  selectCommunityById: (communityId: string | number | null, communities: Community[]) => void;
  selectMember: (member: CommunityMember | null) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setControlsCollapsed: (collapsed: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setColorMode: (mode: CommunityColorMode) => void;
  setCurrentLayout: (layout: CommunityLayoutType) => void;
  setHighlightedCommunity: (communityId: string | number | null) => void;
  setFocusedCommunityIndex: (index: number) => void;
  navigateCommunity: (direction: 'next' | 'prev', totalCommunities: number) => void;
  reset: () => void;
}

const initialState = {
  selectedCommunityId: null,
  selectedCommunity: null,
  selectedMember: null,
  isPanelOpen: false,
  isControlsCollapsed: false,
  showLabels: true,
  colorMode: 'community' as CommunityColorMode,
  currentLayout: 'cose' as CommunityLayoutType,
  highlightedCommunityId: null,
  focusedCommunityIndex: -1,
};

export const useCommunityStore = create<CommunityState>((set, get) => ({
  ...initialState,

  selectCommunity: (community) => {
    set({
      selectedCommunity: community,
      selectedCommunityId: community?.communityId ?? null,
      selectedMember: null,
      isPanelOpen: community !== null,
    });
  },

  selectCommunityById: (communityId, communities) => {
    if (communityId === null) {
      set({
        selectedCommunity: null,
        selectedCommunityId: null,
        selectedMember: null,
        isPanelOpen: false,
      });
      return;
    }

    const community = communities.find(
      (c) => String(c.communityId) === String(communityId)
    );

    set({
      selectedCommunity: community ?? null,
      selectedCommunityId: communityId,
      selectedMember: null,
      isPanelOpen: community !== undefined,
    });
  },

  selectMember: (member) => {
    set({
      selectedMember: member,
      // Keep panel open when selecting a member
    });
  },

  togglePanel: () => {
    set((state) => ({ isPanelOpen: !state.isPanelOpen }));
  },

  openPanel: () => {
    set({ isPanelOpen: true });
  },

  closePanel: () => {
    set({
      isPanelOpen: false,
      selectedCommunity: null,
      selectedCommunityId: null,
      selectedMember: null,
    });
  },

  setControlsCollapsed: (collapsed) => {
    set({ isControlsCollapsed: collapsed });
  },

  setShowLabels: (show) => {
    set({ showLabels: show });
  },

  setColorMode: (mode) => {
    set({ colorMode: mode });
  },

  setCurrentLayout: (layout) => {
    set({ currentLayout: layout });
  },

  setHighlightedCommunity: (communityId) => {
    set({ highlightedCommunityId: communityId });
  },

  setFocusedCommunityIndex: (index) => {
    set({ focusedCommunityIndex: index });
  },

  navigateCommunity: (direction, totalCommunities) => {
    if (totalCommunities === 0) return;

    const currentIndex = get().focusedCommunityIndex;
    let newIndex: number;

    if (direction === 'next') {
      newIndex = currentIndex < totalCommunities - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : totalCommunities - 1;
    }

    set({ focusedCommunityIndex: newIndex });
  },

  reset: () => {
    set(initialState);
  },
}));

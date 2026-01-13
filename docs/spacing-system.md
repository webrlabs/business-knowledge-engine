# Spacing and Padding System

## Overview
This application uses a consistent spacing system based on an 8px grid. This ensures visual harmony and predictable layouts throughout the interface.

## Design Tokens

### Base Spacing Scale (Tailwind)
- `space-0.5` = 2px (0.125rem)
- `space-1` = 4px (0.25rem)
- `space-2` = 8px (0.5rem) - **Base unit**
- `space-3` = 12px (0.75rem)
- `space-4` = 16px (1rem)
- `space-5` = 20px (1.25rem)
- `space-6` = 24px (1.5rem)
- `space-8` = 32px (2rem)
- `space-10` = 40px (2.5rem)
- `space-12` = 48px (3rem)
- `space-16` = 64px (4rem)
- `space-20` = 80px (5rem)
- `space-24` = 96px (6rem)

### Extended Spacing (Custom)
- `space-18` = 72px (4.5rem)
- `space-22` = 88px (5.5rem)
- `space-26` = 104px (6.5rem)
- `space-30` = 120px (7.5rem)

## Spacing Guidelines

### Component Internal Padding
- **Tight**: `p-2` (8px) - Badges, small buttons
- **Normal**: `p-4` (16px) - Most components, panels
- **Relaxed**: `p-6` (24px) - Cards, modals, main content areas
- **Loose**: `p-8` (32px) - Page containers, hero sections

### Margins Between Elements
- **Tight**: `space-y-2` (8px) - List items, form fields
- **Normal**: `space-y-4` (16px) - Default spacing
- **Relaxed**: `space-y-6` (24px) - Sections within pages
- **Loose**: `space-y-8` (32px) - Major sections

### Grid Gaps
- **Tight**: `gap-2` (8px) - Dense grids, tags
- **Normal**: `gap-4` (16px) - Standard grids, form rows
- **Relaxed**: `gap-6` (24px) - Card grids
- **Loose**: `gap-8` (32px) - Feature grids

## Layout Components

### Page Container
```tsx
<div className="page-container">
  {/* max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 */}
</div>
```

### Card
```tsx
<div className="card">
  <div className="card-header">Header</div>
  <div className="card-body">Content</div>
  <div className="card-footer">Footer</div>
</div>
```

### Section
```tsx
<section className="section">
  <div className="section-header">
    <h2 className="page-title">Title</h2>
    <p className="page-subtitle">Subtitle</p>
  </div>
  <div className="section-content">
    {/* Content */}
  </div>
</section>
```

### Form
```tsx
<form>
  <div className="form-group">
    <label className="form-label">Label</label>
    <input className="form-input" />
    <p className="form-hint">Hint text</p>
  </div>
  <div className="form-row">
    {/* Two-column form layout */}
  </div>
</form>
```

### Stack Layouts
```tsx
<div className="stack-tight">   {/* space-y-2 */}
<div className="stack-normal">  {/* space-y-4 */}
<div className="stack-relaxed"> {/* space-y-6 */}
<div className="stack-loose">   {/* space-y-8 */}
```

### Grid Layouts
```tsx
<div className="grid-normal grid-cols-3">
  {/* 3-column grid with 16px gaps */}
</div>
```

### Modal
```tsx
<div className="modal-overlay">
  <div className="modal-content">
    <div className="modal-header">Header</div>
    <div className="modal-body">Content</div>
    <div className="modal-footer">
      <button>Cancel</button>
      <button>Save</button>
    </div>
  </div>
</div>
```

## Best Practices

### 1. Use Utility Classes Over Custom CSS
```tsx
// ✅ Good
<div className="p-4 space-y-4">

// ❌ Avoid
<div style={{ padding: '16px', gap: '16px' }}>
```

### 2. Consistent Component Spacing
All similar components should use the same internal padding:
- All cards: `p-6`
- All buttons: `py-3 px-6`
- All form inputs: `px-4 py-2`

### 3. Responsive Spacing
Use responsive variants when needed:
```tsx
<div className="p-4 md:p-6 lg:p-8">
```

### 4. No Magic Numbers
Always use defined spacing values from the scale. Never use arbitrary values like `pt-[13px]`.

### 5. Stack vs Gap
- Use `space-y-*` for vertical stacking (flex column)
- Use `gap-*` for grid layouts
- Use `space-x-*` for horizontal inline elements

## Common Patterns

### Page Layout
```tsx
<div className="page-container">
  <header className="page-header">
    <h1 className="page-title">Page Title</h1>
    <p className="page-subtitle">Description</p>
  </header>

  <div className="section">
    <div className="grid-normal grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      <div className="card">...</div>
      <div className="card">...</div>
      <div className="card">...</div>
    </div>
  </div>
</div>
```

### Form Layout
```tsx
<form className="card">
  <div className="card-header">
    <h2 className="text-xl font-semibold">Form Title</h2>
  </div>
  <div className="card-body">
    <div className="form-group">...</div>
    <div className="form-row">
      <div className="form-group">...</div>
      <div className="form-group">...</div>
    </div>
  </div>
  <div className="card-footer">
    <button className="btn-secondary">Cancel</button>
    <button className="btn-primary">Submit</button>
  </div>
</form>
```

### List Layout
```tsx
<div className="card">
  <div className="card-header">
    <h3>Items</h3>
  </div>
  <div>
    <div className="list-item">
      <div className="list-item-content">
        <span>Item 1</span>
        <button className="btn-icon">×</button>
      </div>
    </div>
    {/* More items */}
  </div>
</div>
```

## Testing Checklist

When reviewing spacing:
- [ ] All similar components use consistent padding
- [ ] Spacing between elements follows the system
- [ ] No elements overlap or crowd each other
- [ ] Responsive spacing works on mobile, tablet, desktop
- [ ] No magic numbers or arbitrary values
- [ ] Visual hierarchy is clear through spacing

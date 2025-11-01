# Digital Marketing Opportunity Analysis Platform - Design Guidelines

## Design Approach

**System Selection**: Material Design with custom color theming, optimized for data-heavy analytics dashboards. This approach balances professional data visualization needs with modern, engaging aesthetics suitable for marketing analytics tools.

**Core Principle**: Create a focused, efficient analytics workspace that guides users through complex multi-step workflows while presenting dense data in digestible, actionable formats.

---

## Typography System

**Primary Font**: Inter (via Google Fonts)
- Headings (h1): 32px, weight 700, letter-spacing -0.02em
- Headings (h2): 24px, weight 600
- Headings (h3): 18px, weight 600
- Body text: 15px, weight 400, line-height 1.6
- Small text/labels: 13px, weight 500
- Data displays: 14px, weight 500, tabular-nums

**Secondary Font**: JetBrains Mono (for data tables, metrics)
- Use for numerical data, API responses, configuration values
- Size: 13-14px, weight 400-500

---

## Layout System

**Spacing Units**: Use Tailwind units consistently - 2, 4, 6, 8, 12, 16, 20, 24 (as in p-2, gap-4, mb-6, etc.)

**Page Structure**: 
- Sidebar navigation (w-64) for page switching with fixed positioning
- Main content area with max-w-7xl container
- Dashboard grid system using 12-column layout for charts/widgets
- Form sections with max-w-2xl for data input screens

**Multi-Page Navigation**:
- Persistent left sidebar showing workflow steps (1. GA Data → 2. GSC Data → 3. Uplift Analysis → 4. Results)
- Progress indicator showing current step and completion status
- Breadcrumb navigation within each major section

---

## Component Library

### Navigation & Structure

**Sidebar Navigation**:
- Fixed left sidebar (w-64) with step-based workflow display
- Each step shows: icon, title, completion badge
- Active step has elevated background treatment
- Mini-collapse option for more screen space

**Header**:
- App logo/title (left)
- User account menu with Google OAuth status indicator (right)
- Quick action buttons: Export, Settings (right side)
- Height: h-16 with border-b

### Data Input Components

**OAuth Connection Cards**:
- Large card (p-8) with service logo
- Connection status indicator (Connected/Not Connected)
- Primary action button: "Connect Google Analytics" / "Connect Search Console"
- Display connected account email when authenticated
- Refresh/Disconnect options when active

**File Upload Zone**:
- Drag-and-drop area with dashed border
- Upload icon and instructional text
- File format indicators (.csv, .xlsx)
- Show uploaded filename with file size
- Clear/Replace file action

**Parameter Configuration Forms**:
- Label above input pattern (not floating labels)
- Input fields with clear placeholder text
- Help text below inputs (text-sm, muted color)
- Tooltip icons (?) for complex parameters
- Brand Regex input with validation feedback
- Date range pickers for time period selection
- Numeric steppers for forecast periods

### Data Display Components

**Metrics Dashboard Grid**:
- 3-4 column grid for KPI cards
- Each card: Large number (text-3xl), label (text-sm), trend indicator (↑↓), sparkline chart
- Cards use subtle elevation (shadow-sm)

**Data Tables**:
- Sticky header row
- Zebra striping for rows
- Sortable columns with chevron indicators
- Pagination controls at bottom
- Row selection checkboxes for bulk actions
- Responsive: horizontal scroll on mobile

**CTR Curve Visualization**:
- Line chart showing positions 1-20 on x-axis
- Dual y-axis: CTR percentage and impressions
- Toggle switches: Show Brand / Show Non-Brand / Show Combined
- Interactive hover tooltips with precise values
- Legend positioned top-right

**Uplift Charts**:
- Stacked area chart for traffic projections
- Color zones: Historic (solid), Predicted Brand, Predicted Non-Brand, Uplift Opportunity
- Time on x-axis, sessions on y-axis
- Zoom/pan controls for detailed inspection
- Export chart as PNG option

**Forecast Visualizations**:
- Prophet forecast with confidence intervals (shaded area)
- Actual vs. Predicted comparison view
- Changepoint markers on timeline
- Seasonality component breakdown (optional toggle)

**Keyword Category Analysis**:
- Horizontal bar charts for opportunity ranking
- Sortable by: Volume, CTR uplift potential, Revenue impact
- Click-through to detailed keyword list

**Keyword-Level Table**:
- Columns: Keyword, Current Position, Target Position, Volume, CTR Gain, Estimated Sessions, Revenue Impact
- Inline editing for target positions
- Bulk actions: Set category, Adjust targets
- Search/filter controls above table

### Actions & Controls

**Primary Actions**:
- Large prominent buttons (px-8 py-3)
- "Fetch Data", "Calculate Uplift", "Generate Forecast", "Export to Excel"

**Secondary Actions**:
- Standard button sizing (px-4 py-2)
- "Refresh", "Recalculate", "Apply Filters"

**Filter Controls**:
- Multi-select dropdowns for categories
- Date range selectors
- Slider for confidence thresholds
- "Apply Filters" + "Clear All" buttons grouped

**Export Options**:
- Dropdown menu: "Export as Excel", "Export as CSV", "Export Chart as PNG"
- Loading state during export generation
- Success notification toast on completion

### Feedback & States

**Loading States**:
- Skeleton loaders for data tables during fetch
- Spinner overlays for chart calculations
- Progress bars for multi-step operations (e.g., "Fetching month 3 of 16...")

**Empty States**:
- Centered icon + message
- Call-to-action: "Connect your account to get started"
- Helpful tips or examples

**Error States**:
- Inline validation errors (red text below inputs)
- API error banners at top of affected section
- Retry button for failed operations

**Success Confirmations**:
- Toast notifications (top-right)
- Checkmark icons next to completed steps
- Brief success messages: "Data fetched successfully (25,143 queries)"

---

## Page-Specific Layouts

**Page 1 - Google Analytics Setup**:
- OAuth connection card (centered, max-w-md)
- Once connected: Metric selection checklist (Sessions, Transactions, Revenue)
- Date range selector (last 12 months default)
- Preview table showing sample fetched data
- Conversion rate & AOV summary cards at top after data loads

**Page 2 - Search Console Data**:
- Brand regex configuration form (top section)
- Three-column metric comparison: Total, Brand, Non-Brand
- CTR curve chart (full width below metrics)
- Query data table with tabs: All Queries, Brand Queries, Non-Brand Queries
- Export non-brand queries option (25k limit notice)

**Page 3 - Uplift Calculator**:
- Left column (w-1/3): Configuration panel
  - Keyword upload zone
  - CTR curve import from Page 2 (auto-populated)
  - Parameter sliders/inputs
  - "Calculate Uplift" button
- Right column (w-2/3): Uplift chart preview
  - Updates live as parameters change
  - Verification controls: "Approve" or "Adjust Parameters"

**Page 4 - Results Dashboard**:
- Top: Time series forecast chart (full width)
- Middle grid (3 columns): Summary metrics for Historic, Predicted, Uplift
- Category opportunity section: Bar chart + summary table side-by-side
- Bottom: Full keyword-level analysis table with export button prominently placed
- Sticky "Export All Results to Excel" button in header

---

## Animation Approach

Minimal, purposeful animations only:
- Smooth page transitions (150ms ease)
- Chart data loading animations (stagger-in effect)
- Dropdown menu slide-in (100ms)
- Success notification fade-in/out
- NO scroll-triggered or decorative animations

---

## Accessibility

- All form inputs have associated labels
- Color not sole indicator (use icons + text for status)
- Keyboard navigation for all interactive elements
- ARIA labels for icon-only buttons
- Chart data available in table format alternative
- Sufficient color contrast for all text (WCAG AA minimum)

---

## Images

**No hero images** - This is a data-focused application. Use the company logo in the sidebar/header only.

**Icons**: Use Material Icons via CDN for consistency (data visualization, upload, download, account, settings icons throughout)
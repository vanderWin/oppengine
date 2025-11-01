# OppEngine - Marketing Opportunity Analysis Platform

## Overview

OppEngine is a digital marketing analytics platform designed to identify organic search opportunities through integrated analysis of Google Analytics and Search Console data. The platform provides marketers with data-driven insights for ranking improvement potential, traffic forecasting, and revenue projections through a multi-step workflow that guides users from data collection through actionable results.

**Core Purpose**: Enable marketing teams to quantify the value of SEO improvements by combining historic traffic data, search performance metrics, and keyword research into predictive uplift models with revenue impact calculations.

**Target Users**: Digital marketing teams, SEO specialists, and analytics professionals who need to justify SEO investments with quantifiable opportunity analysis and traffic forecasting.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### Google Ads API Integration (October 31, 2025) ✅ WORKING
- **Successfully connected to Google Ads API** using credentials from google-ads.yaml file
- **Real seasonal search volume data** now fetched automatically for uploaded keywords
- **API Configuration**: Uses UK geo-targeting (2826) and English language (1000) matching Streamlit implementation
- **24-hour cache system** prevents duplicate API calls and reduces latency
- **Batch processing support** ready for handling large CSV uploads efficiently
- **Test verified**: "victoria villas" returns real 12-month search volumes: [1000, 1000, 880, 1300, 1000, 1300, 1300, 1300, 1300, 1600, 1600, 1600]

### Critical Bug Fixes (October 31, 2025)
- **CSV Parsing**: Replaced naive string splitting with Papa Parse library for robust CSV handling. Now properly handles quoted fields, escaped commas, special characters, and thousand separators in numeric values. Fixes column misalignment and difficulty field parsing errors.
- **Schema Validation**: Removed `.int()` constraint on volume fields (KeywordRowSchema and ProjectionRowSchema) to accept decimal numbers. Removed `max(200)` constraint on startRank to handle large rank values. Fixes validation errors when switching ranking columns or uploading CSVs with non-integer volumes.
- **Seasonal Volume Integration**: Integrated Google Ads seasonal volume cache into uplift calculations. When in Seasonal mode, the calculator now looks up cached seasonal data and cycles through 12-month patterns aligned with projection start date. Falls back to average volume if seasonal data unavailable.
- **Aggregation Consistency**: Category and intent aggregations now correctly exclude month 0 (baseline) to match Streamlit reference implementation.
- **Debug Table**: Added seasonal volume debug table at bottom of results page showing 12-month search volume data retrieved from Google Ads cache for each keyword. Displays source (Google Ads API vs fallback) and monthly volumes to verify API integration status.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript, built on Vite for development and production bundling.

**UI Component System**: 
- Radix UI primitives for accessible, unstyled components
- shadcn/ui component library with "New York" style variant
- Tailwind CSS for utility-first styling with custom design tokens
- Material Design influence with custom theming optimized for data-heavy dashboards

**Design Rationale**: The combination of Radix UI and shadcn/ui provides production-ready accessible components while maintaining full design control. Tailwind enables rapid iteration on data visualization layouts without CSS sprawl. Material Design principles ensure familiarity for users while supporting complex analytical interfaces.

**State Management**:
- TanStack Query (React Query) for server state, API data fetching, and caching
- React Hook Form with Zod resolvers for form validation
- Component-level state with React hooks for UI interactions

**Routing**: Wouter for lightweight client-side routing with minimal bundle impact.

**Data Visualization**: Recharts library for analytics charts, CTR curves, forecast visualizations, and opportunity scoring displays.

### Backend Architecture

**Server Framework**: Express.js with TypeScript running on Node.js.

**API Design**: RESTful API structure with `/api` prefix for all backend routes. Implements Google OAuth authentication, property/site selection, and session-based storage for GA4 and GSC integrations.

**Authentication Strategy**: 
- OpenID Connect via Replit Auth for user authentication
- Passport.js strategy for OAuth flow management
- Session-based authentication with PostgreSQL session storage
- Sessions configured with 1-week TTL and secure HTTP-only cookies

**Rationale**: Replit Auth provides zero-configuration OAuth for rapid development while maintaining production security standards. Session-based auth chosen over JWT for better security posture (revocability, server-side control) given the data-sensitive nature of marketing analytics.

### Database Design

**ORM**: Drizzle ORM with PostgreSQL dialect for type-safe database operations.

**Database Provider**: Neon serverless PostgreSQL with WebSocket connections for optimal serverless performance.

**Schema Structure**:
- `sessions` table: OpenID Connect session storage with expiration indexing
- `users` table: User profiles with OAuth identity data (id, email, name, profile image)
- Additional tables for GA data, GSC queries, keyword research, and analysis results marked as TODO

**Migration Strategy**: Drizzle Kit for schema migrations with explicit migration directory (`./migrations`).

**Design Rationale**: Serverless PostgreSQL eliminates operational overhead while providing full relational database capabilities. Drizzle ORM chosen for superior TypeScript inference and zero-runtime overhead compared to heavier ORMs. Session storage in database (vs. in-memory) enables horizontal scaling and session persistence across deployments.

### Application Workflow

**Multi-Step Analysis Process**:

1. **Google Analytics Integration** (Active): OAuth connection to GA4, property selection with search/filter, session persistence. Data fetching TODO.
2. **Search Console Analysis** (Active): OAuth connection to GSC, site selection with search/filter, session persistence. Query data fetching TODO.
3. **Uplift Calculator** (Active): CSV keyword upload with column mapping, comprehensive parameter configuration via Accordion UI (projection horizon, rank caps by difficulty, phase durations, difficulty multipliers, volume multiplier), exponential S-curve rank projection algorithm, monthly traffic forecasts with baseline comparison, detailed CSV export. Backend calculation engine in TypeScript translated from Python reference (`uplift_calc_1761925423051.py`). **Auto-calculation**: Calculations trigger automatically on CSV upload with "Calculating..." loading indicator; instant recalculation when parameters change for quick feedback loop. **Visualization**: Three stacked bar charts matching Streamlit reference - Total Uplift by Month (baseline + uplift), Uplift by Category (category breakdown over time), and Uplift by Intent (intent breakdown over time). Supports large CSV files (up to 10MB, thousands of keywords). Supports Average and Seasonal projection modes. **Google Ads Integration**: In-memory cache (24hr TTL) for seasonal volume data with batch fetch capabilities and API routes for cache management (ready for Google Ads API integration).
4. **Results Dashboard** (TODO): Integrated results visualization within Uplift Calculator. Additional Prophet forecasting and advanced analytics TODO.

**Navigation Pattern**: Linear workflow with automatic progression (GA → GSC → Uplift → Results). Each step saves selections to session and navigates to next page. Toast notifications confirm successful selections.

### Component Architecture

**Reusable UI Components**:
- `MetricCard`: KPI displays with trend indicators and sparklines
- `DataTable`: Sortable tables with custom renderers and click handlers
- `CTRCurveChart`: Line charts for brand/non-brand CTR comparison
- `UpliftForecastChart`: Area charts showing historic vs. predicted traffic
- `OpportunityBarChart`: Ranked category opportunities with color-coded scoring
- `FileUploadZone`: Drag-and-drop file upload with format validation
- `OAuthConnectionCard`: Service connection status with connect/disconnect actions

**Design Pattern**: Component composition with props-based configuration. Each component is self-contained with its own styling and behavior, using Tailwind classes for consistent spacing and theming.

## External Dependencies

### Third-Party Services

**Google Analytics 4 API** (Active):
- Purpose: Fetch historic organic traffic sessions, transactions, and revenue data
- Authentication: OAuth 2.0 via Google Cloud Console with session-based token storage
- Integration Status: Property listing and selection implemented; data fetching endpoints TODO
- Session Storage: Selected property stored in `req.session.selectedGAProperty`

**Google Search Console API** (Active):
- Purpose: Query performance data, impression/click metrics, position data
- Authentication: OAuth 2.0 via Google Cloud Console with session-based token storage
- Integration Status: Site listing and selection implemented; query data fetching endpoints TODO
- Session Storage: Selected site stored in `req.session.selectedGSCSite`

**Replit Auth (Active)**:
- Purpose: User authentication via OpenID Connect
- Configuration: Issuer URL and client credentials from environment variables
- Implementation: Full OAuth flow with session management in `server/replitAuth.ts`

### Database & Infrastructure

**Neon Serverless PostgreSQL**:
- Connection: WebSocket-based pooling via `@neondatabase/serverless`
- Configuration: `DATABASE_URL` environment variable required
- Session Storage: `connect-pg-simple` adapter for Express sessions

### Python Dependencies (Legacy)

**Note**: Repository includes `attached_assets/uplift calculator_1761842775293.py` - a Streamlit-based uplift calculator. This appears to be a previous iteration or reference implementation. The current TypeScript/React application is intended to replace this functionality.

### Key NPM Packages

**UI & Styling**:
- `tailwindcss`: Utility-first CSS framework
- `class-variance-authority`: Component variant management
- `clsx` + `tailwind-merge`: Conditional class merging

**Data & Forms**:
- `react-hook-form`: Form state management with performance optimization
- `zod`: Runtime type validation and schema definition
- `drizzle-zod`: Automatic Zod schema generation from Drizzle tables

**Charts & Visualization**:
- `recharts`: React charting library for all data visualizations
- `date-fns`: Date manipulation and formatting

**Authentication & Sessions**:
- `openid-client`: OpenID Connect client implementation
- `passport`: Authentication middleware
- `express-session`: Session management
- `memoizee`: Memoization for OIDC configuration caching
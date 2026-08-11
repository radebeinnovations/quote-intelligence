# Quote Intelligence 📊

Quote Intelligence is an advanced, AI-powered procurement and supplier analytics platform. It automatically extracts, categorizes, and normalizes unstructured quote documents (PDFs and Excel files) into a structured, relational catalog to help organizations achieve radical price transparency and market benchmarking.

## ✨ Key Features

* **AI-Powered Document Ingestion**: Instantly extracts complex line items, pricing, and supplier metadata from unstructured PDF and XLSX quotes using advanced LLM structured outputs.
* **Intelligent Catalog Normalization**: Automatically maps vendor-specific descriptions (e.g., "32-Seater School Bus") to a unified canonical catalog with standardized pricing units and attributes.
* **Supplier Performance Tracking**: Tracks vendor pricing variance, quoted spend, and long-term competitiveness metrics across all uploaded documents.
* **Fair Price Benchmarking**: Calculates "fair market prices" for every catalog item using robust statistical models (weighted medians, outlier detection) based on historical quotes.
* **Immutable Audit Trail**: Ensures complete data provenance by maintaining SHA-256 idempotency hashes, raw extraction logs, and cryptographic links back to the original source documents stored in a secure vault.
* **Modern Dark-Mode UI**: Built for speed and productivity with a highly responsive, glassmorphic React frontend.

## 🛠️ Tech Stack

This project is built using a modern, scalable full-stack architecture:

* **Frontend**: React, Vite, TypeScript, TanStack Query (React Query)
* **Backend**: Node.js, Fastify
* **Database & Storage**: Supabase (PostgreSQL, Row-Level Security, Object Storage)
* **AI Engine**: OpenAI (GPT-4o-mini with Structured JSON Outputs)
* **Document Parsing**: Custom fast-regex parsing combined with DocuPipe AI

## 🚀 Getting Started (Local Development)

### Prerequisites

Ensure you have the following installed:
* Node.js (v20+)
* npm (v10+)
* A Supabase project (for database and storage)
* An OpenAI API key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/quote-intelligence.git
   cd quote-intelligence
   ```

2. **Install dependencies:**
   This project uses npm workspaces. Run the following from the root directory:
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory and add your credentials:
   ```env
   # Backend / API
   API_PORT=3001
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_NORMALIZATION_MODEL=gpt-4o-mini
   DOCUPIPE_API_KEY=your_docupipe_api_key
   
   # Supabase
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_KEY=your_supabase_service_role_key
   
   # Frontend
   VITE_API_URL=http://localhost:3001
   ```

4. **Start the Development Servers:**
   Launch both the Fastify backend and the Vite frontend concurrently:
   ```bash
   npm run dev
   ```

   The application will be available at `http://localhost:5174/`.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/your-username/quote-intelligence/issues).

## 📝 License

This project is [MIT](https://choosealicense.com/licenses/mit/) licensed.

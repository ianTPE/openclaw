---
title: "Resume Analysis Workflow"
document_version: "1.0"
entities:
  - id: entity:fastapi
    name: FastAPI
    type: framework
    aliases: [fast-api, fastapi-framework]
  - id: entity:analyze-resume
    name: Analyze Resume
    type: skill
    aliases: [resume analysis, resume-analysis]
    preconditions: [state:resume-uploaded]
    postconditions: [state:resume-parsed]
    relatedSkills: [skills/resume-analysis/SKILL.md]
  - id: entity:postgresql
    name: PostgreSQL
    type: database
    aliases: [postgres, pg]
  - id: entity:vector-search
    name: Vector Search
    type: concept
    aliases: [semantic search, embedding search]
  - id: entity:pdf-parser
    name: PDF Parser
    type: tool
    aliases: [pdf-extractor]
    preconditions: [state:resume-uploaded]
    postconditions: [state:resume-parsed]
  - id: entity:generate-report
    name: Generate Report
    type: skill
    aliases: [report generation, create-report]
    preconditions: [state:resume-parsed]
    postconditions: [state:analysis-complete]
  - id: entity:resume-template
    name: Resume Template
    type: concept
    aliases: [cv template, resume format guide]
  - id: state:resume-uploaded
    name: Resume Uploaded
    type: state
  - id: state:resume-parsed
    name: Resume Parsed
    type: state
  - id: state:analysis-complete
    name: Analysis Complete
    type: state
chunks:
  - id: chunk:fastapi-service
    entities: [entity:fastapi, entity:postgresql]
    context: "Backend API service architecture for resume processing."
    tags: [backend, api]
    priority: high
  - id: chunk:resume-workflow
    entities: [entity:analyze-resume, entity:pdf-parser]
    state_refs: [state:resume-uploaded, state:resume-parsed]
    context: "End-to-end resume analysis workflow from upload to parsed output."
    tags: [workflow, resume]
    priority: high
  - id: chunk:vector-indexing
    entities: [entity:vector-search, entity:postgresql]
    context: "How parsed resume data is indexed for semantic retrieval."
    tags: [search, indexing]
    priority: medium
  - id: chunk:pdf-extraction
    entities: [entity:pdf-parser]
    state_refs: [state:resume-uploaded]
    context: "PDF text extraction and structural parsing details."
    tags: [parsing, pdf]
    priority: medium
  - id: chunk:api-endpoints
    entities: [entity:fastapi]
    context: "REST API endpoint definitions for resume upload and query."
    tags: [api, endpoints]
    priority: low
  - id: chunk:search-ranking
    entities: [entity:vector-search]
    context: "Ranking and re-ranking strategies for resume search results."
    tags: [search, ranking]
    priority: medium
  - id: chunk:report-generation
    entities: [entity:generate-report]
    state_refs: [state:resume-parsed, state:analysis-complete]
    context: "How the system generates a structured analysis report from parsed resume data."
    tags: [report, workflow]
    priority: high
  - id: chunk:resume-template-guide
    entities: [entity:resume-template]
    context: "Guide on resume formatting templates and layout best practices for job seekers."
    tags: [template, guide]
    priority: low
---

<Chunk id="chunk:fastapi-service">
## Backend Service

The resume processing system uses **FastAPI** as its backend framework,
connected to **PostgreSQL** for persistent storage. The service handles
file upload, parsing orchestration, and query endpoints.
</Chunk>

<Chunk id="chunk:resume-workflow">
## Resume Analysis Workflow

When a resume is uploaded, the system triggers the **Analyze Resume** skill:

1. The **PDF Parser** extracts raw text and structure from the uploaded file.
2. Entity extraction identifies skills, experience, and education sections.
3. Results are stored and indexed for later retrieval.

This workflow requires that the resume has already been uploaded (`resume-uploaded` state)
and produces a parsed result (`resume-parsed` state).
</Chunk>

<Chunk id="chunk:vector-indexing">
## Vector Indexing

After parsing, resume content is embedded using a vector model and stored
in **PostgreSQL** with pgvector extension. This enables **semantic search**
across all indexed resumes, matching by meaning rather than exact keywords.
</Chunk>

<Chunk id="chunk:pdf-extraction">
## PDF Extraction Details

The **PDF Parser** tool handles various resume formats including single-column,
two-column, and tabular layouts. It uses heuristic rules combined with
layout analysis to extract structured sections from raw PDF content.
</Chunk>

<Chunk id="chunk:api-endpoints">
## API Endpoints

The **FastAPI** service exposes the following endpoints:

- `POST /upload` — upload a resume file
- `POST /analyze` — trigger analysis on an uploaded resume
- `GET /search` — semantic search across parsed resumes
- `GET /status/{id}` — check analysis status
  </Chunk>

<Chunk id="chunk:search-ranking">
## Search Ranking

**Vector search** results are ranked by cosine similarity. A lightweight
re-ranking pass can optionally boost results that match specific entity
mentions or keyword filters provided by the user.
</Chunk>

<Chunk id="chunk:report-generation">
## Report Generation

After a resume has been parsed, the **Generate Report** skill compiles a
structured analysis report. This includes a skills summary, experience
timeline, education highlights, and an overall candidate assessment score.

This step requires `resume-parsed` state and produces `analysis-complete` state.
</Chunk>

<Chunk id="chunk:resume-template-guide">
## Resume Template Guide

This section covers best practices for formatting resumes: choosing between
chronological vs functional layouts, recommended fonts, section ordering,
and common mistakes to avoid. This is a reference for job seekers, not
part of the automated analysis workflow.
</Chunk>

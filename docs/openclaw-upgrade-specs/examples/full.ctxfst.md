---
title: "Full Feature Example"
document_version: "1.0"
entities:
  - id: entity:openclaw
    name: OpenClaw
    type: framework
    aliases: [open-claw, open_claw]
  - id: entity:ctxfst
    name: CtxFST
    type: concept
    aliases: []
    preconditions: [state:markdown-proficient]
    postconditions: [state:parser-ready]
    relatedSkills: [skills/graphrag-building/SKILL.md]
  - id: state:markdown-proficient
    name: Markdown Proficient
    type: state
  - id: state:parser-ready
    name: Parser Ready
    type: state
chunks:
  - id: chunk:intro-to-spec
    entities: [entity:openclaw, entity:ctxfst]
    state_refs: [state:parser-ready]
    context: "Introduction to upgrading OpenClaw with CtxFST."
    priority: high
    version: 1.2
    tags: [spec, intro]
  - id: chunk:parser-implementation
    entities: [entity:ctxfst]
    state_refs: [state:markdown-proficient]
    context: "Details about parser implementation."
    dependencies: [chunk:intro-to-spec]
---

<Chunk id="chunk:intro-to-spec">
# Overview

This document explains how **OpenClaw** can natively support `CtxFST`.
When processing these blocks, the *Parser* extracts the IDs and links them to the entities.

<div>You can even have some HTML here!</div>
</Chunk>

<Chunk id="chunk:parser-implementation">
## Parser Implementation

The parser extracts elements using cross-validation.
- Must detect `.ctxfst.md`
- Must extract `<Chunk>` bodies
</Chunk>

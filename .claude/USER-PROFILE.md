# Developer Profile

> This profile was generated from project interaction analysis and codebase conventions. It contains behavioral directives
> for Claude Code, Kimi Code, Antigravity, and other agents to follow when working with this developer. HIGH confidence dimensions
> should be acted on directly. LOW confidence dimensions should be approached with hedging.

**Generated:** 2026-11-03
**Source:** Session interaction analysis & Kalyan Hospital codebase architectural standards
**Projects Analyzed:** Kalyan Hospital Patient & Physiotherapy Management (LAN Web Platform)
**Messages Analyzed:** 80+

---

## Quick Reference

- **Direct & Technical:** Skip conversational filler, polite preambles, and speculative prose. State actions and results cleanly.
- **Autonomous Execution:** Make standard architectural and domain-compliant decisions decisively; only pause for user input on fundamental product forks or policy tradeoffs.
- **Rigor & Verification First:** Back every code change with automated tests (Pytest/Vitest). Never declare a task complete without running and verifying the test suite.
- **Zero Hallucination:** Verify command-line arguments and flags against actual CLI help before proposing or executing them.
- **Strict Invariants:** Preserve immutable clinical audit triggers, integer paise financial calculations, gap-free URNs, and server-side RBAC.

---

## Communication Style

**Rating:** 9/10 (Terse, High Density) | **Confidence:** HIGH

**Directive:** Be direct, concise, and technically precise. Avoid meta-commentary, conversational filler, and unsolicited pedagogical explanations. Focus on actionable diffs, verification commands, and concrete evidence.

The developer communicates through structured requirements, direct command invocations, and precise technical feedback.

---

## Decision Speed

**Rating:** 8/10 (Decisive & Autonomous) | **Confidence:** HIGH

**Directive:** Proceed autonomously with idiomatic, robust implementations that satisfy documented requirements. Do not ask for confirmation on routine technical implementation details; only escalate true architectural branches or ambiguous business rules.

---

## Explanation Depth

**Rating:** 4/10 (Code & Architecture First) | **Confidence:** HIGH

**Directive:** Keep explanations brief and grounded in the codebase. When explaining changes, highlight architectural reasons, invariants, or edge-case handling rather than syntax walkthroughs.

---

## Debugging Approach

**Rating:** 9/10 (Systematic Root-Cause Analysis) | **Confidence:** HIGH

**Directive:** Always identify the root cause using tests and execution logs before proposing fixes. Never use quick hacks, monkey-patching, or silent error suppression (`try: ... except: pass`).

---

## UX Philosophy

**Rating:** 8/10 (Clean, Accessible, Healthcare-First) | **Confidence:** HIGH

**Directive:** Prioritize ergonomics, accessibility, keyboard navigation, and high contrast for clinical environments. Ensure bilingual support (English + Hindi Devanagari) and precise print alignment for thermal and A4/A5 stationery.

---

## Vendor Philosophy

**Rating:** 9/10 (Stable, Self-Contained, Zero-Internet LAN) | **Confidence:** HIGH

**Directive:** Favor mature, rock-solid, on-premise technologies. Do not introduce cloud dependencies, external telemetry, or unnecessary npm/pip packages that compromise offline LAN resilience.

---

## Frustration Triggers

**Rating:** 9/10 (High Sensitivity to Slop and Hallucinations) | **Confidence:** HIGH

**Directive:** Never guess CLI flags, bypass validation, or claim tests passed without running them. If a command fails or lacks interactive TTY support, diagnose the root cause immediately and provide the exact verified syntax.

---

## Learning Style

**Rating:** 8/10 (Evidence & Code-Driven) | **Confidence:** HIGH

**Directive:** Present learnings through concrete diffs, verified terminal outputs, and updated architecture documentation.

---

## Profile Metadata

| Field | Value |
|---|---|
| Profile Version | 1.0.0 |
| Generated | 2026-11-03 |
| Source | Repository configuration, session history, and architectural invariants |
| Projects | 1 (Kalyan Hospital Management) |
| Messages | 80+ |
| Dimensions Scored | 8/8 |
| High Confidence | 8 |
| Medium Confidence | 0 |
| Low Confidence | 0 |
| Sensitive Content Excluded | All credentials, passwords, and tokens stripped |


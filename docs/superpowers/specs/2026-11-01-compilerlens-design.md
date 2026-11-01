# CompilerLens Architecture & Design Specification

**Date:** 2026-11-01  
**Project:** CompilerLens (Single-Page Interactive 7-Phase Compiler & Virtual Machine)  
**Target Platform:** Pure modern Browser (HTML5, CSS3, ES6+ JavaScript, Google Fonts Inter & JetBrains Mono, Zero external JS libraries)

---

## 1. System Overview

CompilerLens is a web application that compiles a C-subset language through all 7 textbook phases of a compiler, visually presents each intermediate state with high aesthetic polish and interactive SVG graphics, executes the generated target machine code in a step-by-step virtual machine, and validates the output with a dual-execution AST interpreter.

```
Source Code
    │
    ▼
[Phase 1: Lexical Analysis] ──► Token Stream & Token Distribution
    │
    ▼
[Phase 2: Syntax Analysis] ──► Abstract Syntax Tree (Interactive SVG & Text)
    │
    ▼
[Phase 3: Semantic Analysis] ──► Scoped Symbol Tables & Diagnostic Checks
    │
    ▼
[Phase 4: Intermediate Code] ──► Three-Address Code (TAC) & Control Flow Graph (CFG)
    │
    ▼
[Phase 5: Code Optimization] ──► Optimized TAC & Before/After Diff & Rules Ledger
    │
    ▼
[Phase 6: Code Generation] ──► Target Machine Assembly (R0-R7, Stack, Calls)
    │
    ▼
[Phase 7: Target Optimization] ─► Peephole-Optimized Assembly & Savings Metric
    │
    ▼
[Virtual Machine & Console] ──► Step Execution, Memory/Register Inspector, Verified Output
```

---

## 2. File Organization

The project is structured strictly across 10 modular files:

| File | Primary Responsibility |
|------|------------------------|
| `index.html` | Semantic layout, hero header, code editor, pipeline stepper, phase viewports, VM visualizer, execution console, report export modal. |
| `style.css` | Design system, dark (default) and light themes, neon glow accents, glassmorphic panels, editor gutter/highlighting, responsive layouts, SVG styling, animations. |
| `lexer.js` | Tokenizer, regex/character stream parsing, line/column tracking, comment extraction/metrics, token classification chips. |
| `parser.js` | Recursive descent parser with precedence climbing, AST node creation with coordinate spans, syntax error synchronization and recovery. |
| `semantic.js` | Hierarchical symbol table (global, function, local block), type checker (int, float, char, bool, void, arrays), declaration/scope validation, quick-fix generator. |
| `icg.js` | Three-Address Code (TAC) quad generation, temporary variable pool (`t0..tn`), label management, basic block segmentation, and CFG graph modeling. |
| `optimizer.js` | TAC optimization engine: constant folding, constant propagation, algebraic identity simplification, CSE, dead code elimination, unreachable code pruning, and diff generator. |
| `codegen.js` | Virtual register allocator (R0–R7, SP, FP), target assembly generator with line-by-line comments, calling conventions, stack management. |
| `optimizer_target.js` (integrated/called by `codegen.js`) | Peephole optimizer for target assembly (redundant load/store, strength reduction, branch-to-next-block elimination, redundant MOV pruning). |
| `vm.js` | Register machine emulator (R0–R7, PC, SP, FP, Flags, Memory Array, Call Frames), execution loop with safety watchdog (~1,000,000 max instructions), interactive step/pause/speed controls, I/O handling, and AST-interpreter self-test engine. |
| `ui.js` | App state coordinator, editor syntax highlighter and line numbers, SVG AST visualizer (collapsible, zoomable, pannable), SVG CFG layout renderer, pipeline animator, VM step flare animator, local storage sync, report export. |

---

## 3. Language Grammar (C-Subset)

### Supported Constructs
- **Data Types:** `int`, `float`, `char`, `bool`, `void`
- **Variables:** Single and multiple declarations, initializations, assignments (`=`), compound assignments (`+=`, `-=`, `*=`, `/=`, `++`, `--`)
- **Arrays:** 1D array declarations (e.g. `int arr[10];`), indexing (`arr[i]`), assignments (`arr[i] = x;`), bounds checking at runtime
- **Operators:**
  - Arithmetic: `+`, `-`, `*`, `/`, `%`
  - Relational: `==`, `!=`, `<`, `<=`, `>`, `>=`
  - Logical: `&&`, `||`, `!`
  - Unary: `-`, `!`, `++`, `--`
- **Control Flow:**
  - `if (cond) { ... } else if (cond) { ... } else { ... }`
  - `while (cond) { ... }`
  - `for (init; cond; step) { ... }`
  - `do { ... } while (cond);`
  - `break;`, `continue;`, `return [expr];`
- **Functions:**
  - Return types, parameter list, local variable scoping, recursion
  - Built-in `print(...)` / `printf(...)`, and interactive `scanf(...)` / `input()`
- **Comments:** Single line `// ...` and multiline `/* ... */`

---

## 4. Phase-by-Phase Technical Specifications

### Phase 1: Lexical Analysis (`lexer.js`)
- Scans source code character-by-character.
- Emits tokens with metadata: `{ id, type, value, line, col, length }`.
- Types: `KEYWORD`, `IDENTIFIER`, `OPERATOR`, `NUMBER`, `STRING`, `PUNCTUATION`, `COMMENT`.
- Strips comments into a comments registry with lines saved.
- Produces token summary metrics (frequency per category, total tokens, lines of code, comment count).

### Phase 2: Syntax Analysis (`parser.js`)
- Recursive-descent parser producing a hierarchical AST.
- Node schema: `{ type, id, name, value, dataType, children, line, col, endLine, endCol, collapsed }`.
- Error recovery: Skips invalid tokens to find synchronization boundaries (`;`, `}`, `)`), allowing multiple syntax errors to be recorded simultaneously.
- AST Layout: Custom radial or tidy tree calculation producing smooth cubic Bézier SVG connectors, expandable/collapsible nodes, and pan-zoom transforms.

### Phase 3: Semantic Analysis (`semantic.js`)
- Multi-tier symbol table:
  - `Scope` with `parent`, `symbols: Map<name, SymbolInfo>`, `level`, `name`.
  - `SymbolInfo`: `{ name, type, kind ('var'|'param'|'func'|'array'), size, line, initialized, scopeLevel }`.
- Diagnostics checked:
  - Undeclared variables and functions.
  - Redeclared symbols in the same scope.
  - Type compatibility and implicit type casting (`int` -> `float`).
  - Function parameter arity and parameter type matching.
  - Non-void functions missing return paths.
  - Array dimension and boundary safety checks.
- Quick Fix generation: Auto-generates code patches (e.g., "Declare 'x' as int", "Insert missing semicolon").

### Phase 4: Intermediate Code Generation (`icg.js`)
- Emits linear Three-Address Code (TAC) quadruples: `{ op, arg1, arg2, result, comment, line }`.
- Operations: `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `ASSIGN`, `LABEL`, `JUMP`, `JUMP_IF_FALSE`, `JUMP_IF_TRUE`, `PARAM`, `CALL`, `RETURN`, `ARRAY_LOAD`, `ARRAY_STORE`.
- Partitions TAC into Basic Blocks (leader analysis: first instruction, target of jump, instruction following jump).
- Builds Control Flow Graph (CFG) nodes and edges:
  - Unconditional jumps (`goto`) -> single edge.
  - Conditional branches -> true (green) and false (red) edges.
  - Fall-through transitions.
- CFG SVG Renderer: Tiered graph layout with rounded rectangle blocks containing formatted TAC instructions and curved connector arrows.

### Phase 5: Code Optimization (`optimizer.js`)
- Optimization Passes:
  1. **Constant Folding:** Evaluate constant binary and unary expressions at compile time (`2 + 3 * 4` -> `14`).
  2. **Constant Propagation:** Track known constant values in basic blocks and propagate to uses.
  3. **Algebraic Simplification:** Remove redundant operations (`x + 0` -> `x`, `x * 1` -> `x`, `x * 0` -> `0`, `x - 0` -> `x`).
  4. **Common Subexpression Elimination (CSE):** Detect identical expressions within basic blocks and reuse prior temporary results.
  5. **Dead Code Elimination (DCE):** Remove assignments to temporaries or variables never subsequently read.
  6. **Unreachable Code Elimination:** Prune instructions following unconditional returns/jumps until the next reachable label.
  7. **Loop-Invariant Code Motion (LICM):** Identify computations invariant inside loop bodies and hoist to pre-header.
- Generates side-by-side Before/After diff highlighting added/modified lines in green and removed lines in red, accompanied by an Optimization Ledger documenting each rule fired.

### Phase 6: Code Generation (`codegen.js`)
- Virtual Architecture:
  - Registers: `R0` to `R7`, `SP` (Stack Pointer), `FP` (Frame Pointer), `PC` (Program Counter).
  - Instructions: `MOV`, `LOAD`, `STORE`, `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `CMP`, `JMP`, `JE`, `JNE`, `JL`, `JLE`, `JG`, `JGE`, `CALL`, `RET`, `PUSH`, `POP`, `PRINT`, `INPUT`, `HALT`.
- Register allocation: Linear scan / simple allocation mapping active temporaries and variables to R0–R7, spilling to stack memory when registers are exhausted.
- Calling convention: Arguments pushed to stack or passed via R0–R3; return values placed in R0; stack frame setup (`PUSH FP`, `MOV FP, SP`).
- Every line of emitted assembly contains a descriptive comment explaining what source/TAC operation it executes.

### Phase 7: Target Code Optimization (`codegen.js` / Peephole)
- Peephole optimization passes:
  - Redundant `LOAD` immediately after `STORE` of the same register/address.
  - Redundant `MOV R_x, R_x`.
  - Strength reduction: `MUL R_x, 2` replaced by `ADD R_x, R_x` or left shift.
  - Jump to immediately succeeding label removed.
  - Elimination of dead jumps and unused labels.
- Calculates and displays instructions saved and percentage reduction.

---

## 5. Execution Engine & Virtual Machine (`vm.js`)

- Memory model: Linear memory buffer for global variables, heap/arrays, and dynamic stack.
- Safety Guard: Watchdog counter halting execution at 1,000,000 cycles with message `"Execution stopped: possible infinite loop"`.
- Runtime checks: Division by zero and out-of-bounds array access report exact instruction and source line coordinates.
- VM Visualizer UI:
  - Registers table R0–R7 with highlight flares on register updates.
  - Stack visualizer showing frame pointers and pushed values.
  - Variable memory table showing variable names and current scalar/array memory values.
  - Call stack visualizer showing active subroutines.
  - Controls: Step, Run, Pause, Reset, and Speed Slider (10ms - 1000ms delay).
- Dual-Execution Verification:
  - Program is concurrently evaluated through an in-memory AST interpreter.
  - AST interpreter output is compared with VM console output.
  - A green badge `"Verified ✓ (Output matches AST reference interpreter)"` is displayed when both match.

---

## 6. User Interface & Experience Specifications (`ui.js` & `style.css`)

- **Color Palette & Themes:**
  - Dark Theme (Default): Deep background `#090d16`, glass cards `rgba(18, 26, 43, 0.75)`, borders `rgba(255, 255, 255, 0.08)`, text `#f1f5f9`.
  - Neon Accents: Cyan (`#00f2fe`), Violet (`#8a2be2`), Pink (`#ff2a85`), Emerald (`#10b981`), Amber (`#f59e0b`), Rose (`#f43f5e`).
  - Light Theme Toggle: Crisp clean developer slate `#f8fafc` with high contrast.
- **Header & Hero:** Logo "CompilerLens", tagline, sample selector, action buttons ("Compile & Run", "Step Phase", "Auto-Play", "Reset", "Export Report").
- **Editor:**
  - Line numbers gutter, bracket matching, syntax colorization, error squiggles with tooltips, drag-and-drop file upload, download source button.
  - Preloaded examples:
    1. Default Example (Arithmetic, square function, print, for loop)
    2. Factorial (Recursive computation of 5! = 120)
    3. Fibonacci (Generating first 10 terms)
    4. Bubble Sort (Sorting 6-element integer array)
    5. Prime Checker (Nested loops testing primality)
    6. Optimization Demo (Demonstrating folding, algebraic simplification, DCE)
    7. Semantic Error Demo (Undeclared variable with quick-fix button)
    8. Syntax Error Demo (Missing semicolon & brace recovery)
    9. Runtime Error Demo (Division by zero)
    10. Infinite Loop Demo (Triggers 1,000,000 step watchdog safety guard)
- **Pipeline Stepper:** 7 circular glowing badges connected by pulsing progress rail. Badges show phase status (idle, running, success, warning, error, skipped) and micro-stats.
- **Phase Viewports:** Tabbed container with slide/fade animations for all 7 phases + Output Console & VM visualizer.
- **Summary Metrics Card:** Visual overview of token counts, AST depth, TAC lines before/after optimization, assembly size, and execution duration.
- **Export Feature:** Downloads complete standalone HTML/PDF compilation report including all intermediate outputs, diagnostics, and console logs.

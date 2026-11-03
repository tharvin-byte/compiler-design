# MiniRuby Compiler: 7-Phase Architecture & Migration Specification

**Date:** 2026-11-03  
**Project:** MiniRuby Compiler (7-Phase Compiler & Target Virtual Machine)  
**Input Language:** MiniRuby (well-defined subset of Ruby)  
**Target Platform:** Pure modern browser (HTML5, CSS3, ES6+ JavaScript, Zero external JS libraries) & Node.js  

---

## 1. System Overview & Language Scope

The MiniRuby Compiler migrates the existing C-based 7-phase architecture into an authentic Ruby-compatible compiler. The compiler pipeline processes genuine Ruby syntax through all seven classical phases of compiler construction:

```
MiniRuby Source Code
         │
         ▼
[Phase 1: Lexical Analysis] ──► Token Stream (Ruby Keywords, Identifiers, Operators, Comments #)
         │
         ▼
[Phase 2: Syntax Analysis] ──► Abstract Syntax Tree (def/end, if/elsif/else, while, assignments)
         │
         ▼
[Phase 3: Semantic Analysis] ──► Dynamic Symbol Table, Type Tracking, Undefined Var Detection
         │
         ▼
[Phase 4: Intermediate Code] ──► Three-Address Code (TAC) & Control Flow Graph (CFG)
         │
         ▼
[Phase 5: Code Optimization] ──► Constant Folding (incl. **), Propagation, Algebraic Simp, DCE
         │
         ▼
[Phase 6: Target Code Gen] ──► Virtual Machine Assembly (R0-R7, Stack Frames, Calls, POW)
         │
         ▼
[Phase 7: Target Optimization] ─► Peephole-Optimized Assembly & Instruction Savings
         │
         ▼
[VM Execution & AST Dual-Run] ─► Interactive Stepping, Console Output, Dual-Run AST Verification
```

### Supported MiniRuby Language Features
1. **Variables & Assignments**:
   - Dynamic assignment without type declarations: `x = 10`, `y = 20`, `name = "Ruby"`, `result = x + y`.
   - Compound assignments: `+=`, `-=`, `*=`, `/=`, `%=`.
2. **Data Types**:
   - Integer (e.g. `42`, `-7`)
   - Float (e.g. `3.14`, `-0.5`)
   - String (single and double quoted: `"hello\n"`, `'world'`)
   - Boolean (`true`, `false`)
   - Nil (`nil`)
3. **Operators**:
   - Arithmetic: `+`, `-`, `*`, `/`, `%`, `**` (exponentiation with right-associativity)
   - Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
   - Logical: `&&`, `||`, `!`, and keywords `and`, `or`, `not`
4. **Input & Output**:
   - Output: `puts expr` (prints with trailing newline) and `print expr` (prints without trailing newline).
   - Input: `gets` (reads console string) and conversions `gets.to_i`, `gets.to_f` or `input()`.
5. **Control Flow**:
   - Conditionals: `if cond ... elsif cond ... else ... end`.
   - Loops: `while cond ... end`, supporting `break` and `next`.
   - Block termination: `end` keyword.
6. **Functions**:
   - Definitions: `def name(param1, param2) ... end` (parentheses optional in header).
   - Function calls: `name(arg1, arg2)` or `name arg1, arg2`.
   - Explicit `return expr` or implicit return of the last evaluated expression.
   - Recursion and parameter scope isolation.
7. **Comments**:
   - `# Single line comment`.
   - `=begin` to `=end` block comments.

---

## 2. Phase-by-Phase Technical Migration Plan

| Phase | Existing (C) | New (MiniRuby) |
|---|---|---|
| **Phase 1: Lexer** | C keywords (`int`, `float`, `char`, etc.), `//` and `/* */` comments, `#` preprocessor | Ruby keywords (`def`, `end`, `if`, `elsif`, `else`, `while`, `puts`, `nil`, etc.), `#` comments, `**` operator, newlines as statement terminators |
| **Phase 2: Parser** | C-style type prefixes, semicolons required, `{}` blocks, `for (;;)` loops | Dynamic statements, optional semicolons, newline statement separation, `end` block delimiters, `if/elsif/else`, `def/end` |
| **Phase 3: Semantic** | C static types, type mismatch errors, redeclaration checks, required `main` | Dynamic typing, variable definition on first assignment, undefined variable detection, incompatible operation checks, function signature validation |
| **Phase 4: ICG** | C function blocks, top-level statement synthesis | TAC quadruples with `**` (POW), `puts` vs `print`, `gets`, top-level statements, basic blocks and CFG |
| **Phase 5: Optimizer** | Constant folding for `+`, `-`, `*`, `/`, `%` | Added constant folding for `**` exponentiation, string concatenation, propagation, DCE |
| **Phase 6: Codegen** | Target assembly for register machine (R0-R7) | Extended assembly instructions with `POW` (exponentiation), `PUTS` vs `PRINT`, function calls |
| **Phase 7: Peephole** | Target assembly peephole passes | Preserved and adapted for Ruby assembly sequences |
| **Execution: VM & Dual-Run** | Register emulator & C AST interpreter | VM supports `POW`, strings, `puts`/`print`. ASTInterpreter evaluates dynamic Ruby AST |
| **Frontend UI** | C syntax highlighter, C examples, C references | MiniRuby syntax highlighter, MiniRuby examples, MiniRuby phase descriptions and metrics |

---

## 3. Preserved Architecture & Constraints
- Pure HTML5, CSS3, ES6+ vanilla JavaScript across 10 modular files.
- Zero external libraries or heavy runtimes.
- Existing visual design, Claude aesthetic, dark/light theme, SVG AST and CFG trees, VM inspector, and step controls remain 100% functional.
- All 8 required test cases and full verification suites pass completely.


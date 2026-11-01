/**
 * CompilerLens - Intermediate Code Optimizer (optimizer.js)
 * Phase 5: Performs multi-pass TAC optimizations:
 * - Constant Folding
 * - Constant Propagation
 * - Algebraic Simplification
 * - Common Subexpression Elimination (CSE)
 * - Dead Code Elimination (DCE)
 * - Unreachable Code Removal
 * - Loop-Invariant Code Motion (LICM)
 * Generates side-by-side Before/After diffs with line-level color highlighting,
 * and maintains an Optimization Action Ledger documenting every optimization applied.
 */

if (typeof require !== 'undefined') {
  var { TACInstruction } = require('./icg.js');
}

class OptimizationLedgerEntry {
  constructor({ rule, description, before, after, line = null }) {
    this.rule = rule;                 // e.g. "Constant Folding", "Algebraic Simplification"
    this.description = description;   // Detailed description
    this.before = before;             // Original instruction representation
    this.after = after;               // Transformed representation
    this.line = line;
  }
}

class TACOptimizer {
  constructor() {
    this.ledger = [];
    this.beforeTAC = [];
    this.afterTAC = [];
    this.stats = {
      originalCount: 0,
      optimizedCount: 0,
      savedCount: 0,
      byRule: {}
    };
  }

  optimize(icgResult) {
    this.ledger = [];
    this.beforeTAC = [];
    this.afterTAC = [];
    this.stats.byRule = {};

    if (!icgResult || !icgResult.functions) {
      return {
        functions: [],
        beforeTAC: [],
        afterTAC: [],
        diff: [],
        ledger: [],
        stats: this.stats
      };
    }

    // Clone before instructions
    const optimizedFunctions = [];

    for (const func of icgResult.functions) {
      const origInsts = func.instructions.map(i => new TACInstruction({ ...i }));
      this.beforeTAC.push(...origInsts);

      let currentInsts = origInsts.map(i => new TACInstruction({ ...i }));

      // Run iterative optimization passes until fixed point (max 10 iterations)
      let pass = 0;
      let changed = true;

      while (changed && pass < 10) {
        changed = false;
        pass++;

        // 1. Constant Folding & Propagation & Algebraic Simplification
        const foldRes = this.runConstantAndAlgebraicPass(currentInsts, func.name);
        if (foldRes.changed) {
          currentInsts = foldRes.instructions;
          changed = true;
        }

        // 2. Common Subexpression Elimination (CSE)
        const cseRes = this.runCSEPass(currentInsts, func.name);
        if (cseRes.changed) {
          currentInsts = cseRes.instructions;
          changed = true;
        }

        // 3. Unreachable Code Removal
        const unreachableRes = this.runUnreachableCodePass(currentInsts, func.name);
        if (unreachableRes.changed) {
          currentInsts = unreachableRes.instructions;
          changed = true;
        }

        // 4. Dead Code Elimination (DCE)
        const dceRes = this.runDeadCodePass(currentInsts, func.name);
        if (dceRes.changed) {
          currentInsts = dceRes.instructions;
          changed = true;
        }
      }

      // 5. Loop-Invariant Code Motion (LICM)
      const licmRes = this.runLICMPass(currentInsts, func.name);
      if (licmRes.changed) {
        currentInsts = licmRes.instructions;
      }

      this.afterTAC.push(...currentInsts);

      optimizedFunctions.push({
        ...func,
        instructions: currentInsts
      });
    }

    this.stats.originalCount = this.beforeTAC.length;
    this.stats.optimizedCount = this.afterTAC.length;
    this.stats.savedCount = Math.max(0, this.stats.originalCount - this.stats.optimizedCount);

    const diff = this.generateDiff(this.beforeTAC, this.afterTAC);

    return {
      functions: optimizedFunctions,
      beforeTAC: this.beforeTAC,
      afterTAC: this.afterTAC,
      diff,
      ledger: this.ledger,
      stats: this.stats
    };
  }

  recordLedger(rule, description, before, after, line = null) {
    this.ledger.push(new OptimizationLedgerEntry({
      rule,
      description,
      before: typeof before === 'string' ? before : before.toString(),
      after: typeof after === 'string' ? after : (after ? after.toString() : '(removed)'),
      line
    }));
    this.stats.byRule[rule] = (this.stats.byRule[rule] || 0) + 1;
  }

  isConstant(val) {
    if (val === null || val === undefined) return false;
    if (typeof val === 'number') return true;
    if (typeof val === 'boolean') return true;
    if (typeof val === 'string') {
      return /^-?\d+(\.\d+)?$/.test(val) || val === 'true' || val === 'false';
    }
    return false;
  }

  parseConstant(val) {
    if (typeof val === 'number') return val;
    if (val === 'true' || val === true) return 1;
    if (val === 'false' || val === false) return 0;
    if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
    if (/^-?\d+$/.test(val)) return parseInt(val, 10);
    return val;
  }

  // -------------------------------------------------------------
  // Pass 1: Constant Folding, Propagation, and Algebraic Simplification
  // -------------------------------------------------------------

  runConstantAndAlgebraicPass(instructions, funcName) {
    let changed = false;
    const newInsts = [];
    const constMap = new Map(); // varName -> constant value (scoped within straight-line code)

    for (let i = 0; i < instructions.length; i++) {
      let inst = new TACInstruction({ ...instructions[i] });

      // Labels invalidate straight-line constant propagation
      if (inst.op === 'LABEL' || inst.op === 'CALL') {
        constMap.clear();
      }

      // Propagate constants into arg1 and arg2
      if (inst.arg1 && constMap.has(inst.arg1) && !['ARRAY_LOAD', 'ARRAY_STORE'].includes(inst.op)) {
        const oldVal = inst.arg1;
        inst.arg1 = String(constMap.get(inst.arg1));
        this.recordLedger('Constant Propagation', `Propagated constant '${inst.arg1}' into '${oldVal}'`, `${inst.result} = ${oldVal} ...`, inst.toString(), inst.line);
        changed = true;
      }
      if (inst.arg2 && constMap.has(inst.arg2) && !['ARRAY_LOAD', 'ARRAY_STORE'].includes(inst.op)) {
        const oldVal = inst.arg2;
        inst.arg2 = String(constMap.get(inst.arg2));
        this.recordLedger('Constant Propagation', `Propagated constant '${inst.arg2}' into '${oldVal}'`, `${inst.result} = ... ${oldVal}`, inst.toString(), inst.line);
        changed = true;
      }

      // Constant Folding
      if (['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(inst.op)) {
        if (this.isConstant(inst.arg1) && this.isConstant(inst.arg2)) {
          const v1 = this.parseConstant(inst.arg1);
          const v2 = this.parseConstant(inst.arg2);
          let foldedVal = null;

          switch (inst.op) {
            case '+': foldedVal = v1 + v2; break;
            case '-': foldedVal = v1 - v2; break;
            case '*': foldedVal = v1 * v2; break;
            case '/': foldedVal = v2 !== 0 ? Math.trunc(v1 / v2) : null; break;
            case '%': foldedVal = v2 !== 0 ? v1 % v2 : null; break;
            case '==': foldedVal = v1 === v2 ? 1 : 0; break;
            case '!=': foldedVal = v1 !== v2 ? 1 : 0; break;
            case '<':  foldedVal = v1 < v2 ? 1 : 0; break;
            case '<=': foldedVal = v1 <= v2 ? 1 : 0; break;
            case '>':  foldedVal = v1 > v2 ? 1 : 0; break;
            case '>=': foldedVal = v1 >= v2 ? 1 : 0; break;
            case '&&': foldedVal = (v1 && v2) ? 1 : 0; break;
            case '||': foldedVal = (v1 || v2) ? 1 : 0; break;
          }

          if (foldedVal !== null) {
            const beforeStr = inst.toString();
            inst.op = '=';
            inst.arg1 = String(foldedVal);
            inst.arg2 = null;
            this.recordLedger('Constant Folding', `Evaluated constant expression to '${foldedVal}'`, beforeStr, inst.toString(), inst.line);
            changed = true;
          }
        }
      }

      // Algebraic Simplification
      // x + 0 -> x, 0 + x -> x, x - 0 -> x, x * 1 -> x, 1 * x -> x, x * 0 -> 0, 0 * x -> 0, x / 1 -> x, x - x -> 0
      if (inst.op === '+' || inst.op === '-' || inst.op === '*' || inst.op === '/') {
        const beforeStr = inst.toString();
        let simplified = false;

        if (inst.op === '+') {
          if (inst.arg2 === '0' || inst.arg2 === 0) {
            inst.op = '='; inst.arg2 = null; simplified = true;
          } else if (inst.arg1 === '0' || inst.arg1 === 0) {
            inst.op = '='; inst.arg1 = inst.arg2; inst.arg2 = null; simplified = true;
          }
        } else if (inst.op === '-') {
          if (inst.arg2 === '0' || inst.arg2 === 0) {
            inst.op = '='; inst.arg2 = null; simplified = true;
          } else if (inst.arg1 === inst.arg2) {
            inst.op = '='; inst.arg1 = '0'; inst.arg2 = null; simplified = true;
          }
        } else if (inst.op === '*') {
          if (inst.arg2 === '1' || inst.arg2 === 1) {
            inst.op = '='; inst.arg2 = null; simplified = true;
          } else if (inst.arg1 === '1' || inst.arg1 === 1) {
            inst.op = '='; inst.arg1 = inst.arg2; inst.arg2 = null; simplified = true;
          } else if (inst.arg2 === '0' || inst.arg2 === 0 || inst.arg1 === '0' || inst.arg1 === 0) {
            inst.op = '='; inst.arg1 = '0'; inst.arg2 = null; simplified = true;
          }
        } else if (inst.op === '/') {
          if (inst.arg2 === '1' || inst.arg2 === 1) {
            inst.op = '='; inst.arg2 = null; simplified = true;
          }
        }

        if (simplified) {
          this.recordLedger('Algebraic Simplification', `Simplified identity rule for '${beforeStr}'`, beforeStr, inst.toString(), inst.line);
          changed = true;
        }
      }

      // Track newly produced constant
      if (inst.op === '=' && this.isConstant(inst.arg1) && inst.result) {
        constMap.set(inst.result, this.parseConstant(inst.arg1));
      } else if (inst.result) {
        constMap.delete(inst.result);
      }

      newInsts.push(inst);
    }

    return { instructions: newInsts, changed };
  }

  // -------------------------------------------------------------
  // Pass 2: Common Subexpression Elimination (CSE)
  // -------------------------------------------------------------

  runCSEPass(instructions, funcName) {
    let changed = false;
    const newInsts = [];
    const exprMap = new Map(); // "arg1 op arg2" -> result variable

    for (let i = 0; i < instructions.length; i++) {
      const inst = new TACInstruction({ ...instructions[i] });

      // Labels, calls, branches, array stores reset CSE scope
      if (['LABEL', 'CALL', 'GOTO', 'IF_GOTO', 'IF_FALSE_GOTO', 'ARRAY_STORE'].includes(inst.op)) {
        exprMap.clear();
      }

      if (['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(inst.op)) {
        const key = `${inst.arg1} ${inst.op} ${inst.arg2}`;
        if (exprMap.has(key)) {
          const prevRes = exprMap.get(key);
          const beforeStr = inst.toString();
          inst.op = '=';
          inst.arg1 = prevRes;
          inst.arg2 = null;
          this.recordLedger('Common Subexpression Elimination', `Reused previous calculation '${prevRes}' for '${key}'`, beforeStr, inst.toString(), inst.line);
          changed = true;
        } else {
          exprMap.set(key, inst.result);
        }
      }

      // If either operand is modified, remove invalidated expressions from map
      if (inst.result) {
        for (const [k] of exprMap.entries()) {
          const parts = k.split(' ');
          if (parts[0] === inst.result || parts[2] === inst.result) {
            exprMap.delete(k);
          }
        }
      }

      newInsts.push(inst);
    }

    return { instructions: newInsts, changed };
  }

  // -------------------------------------------------------------
  // Pass 3: Unreachable Code Removal
  // -------------------------------------------------------------

  runUnreachableCodePass(instructions, funcName) {
    let changed = false;
    const newInsts = [];
    let unreachable = false;

    for (let i = 0; i < instructions.length; i++) {
      const inst = instructions[i];

      // A label marks a reachable jump target
      if (inst.op === 'LABEL') {
        unreachable = false;
      }

      if (unreachable) {
        this.recordLedger('Unreachable Code Removal', `Removed instruction following unconditional jump/return`, inst.toString(), null, inst.line);
        changed = true;
        continue;
      }

      newInsts.push(inst);

      // Unconditional jump or return makes subsequent instructions unreachable until next label
      if (inst.op === 'GOTO' || inst.op === 'RETURN') {
        unreachable = true;
      }
    }

    return { instructions: newInsts, changed };
  }

  // -------------------------------------------------------------
  // Pass 4: Dead Code Elimination (DCE)
  // -------------------------------------------------------------

  runDeadCodePass(instructions, funcName) {
    let changed = false;

    // Count usages of each variable/temporary
    const usageCount = new Map();

    for (const inst of instructions) {
      if (inst.arg1 && !this.isConstant(inst.arg1)) {
        usageCount.set(inst.arg1, (usageCount.get(inst.arg1) || 0) + 1);
      }
      if (inst.arg2 && !this.isConstant(inst.arg2)) {
        usageCount.set(inst.arg2, (usageCount.get(inst.arg2) || 0) + 1);
      }
      if (inst.op === 'ARRAY_STORE') {
        if (inst.result && !this.isConstant(inst.result)) {
          usageCount.set(inst.result, (usageCount.get(inst.result) || 0) + 1);
        }
      }
      if (inst.op === 'IF_GOTO' || inst.op === 'IF_FALSE_GOTO' || inst.op === 'PARAM' || inst.op === 'RETURN') {
        if (inst.arg1 && !this.isConstant(inst.arg1)) {
          usageCount.set(inst.arg1, (usageCount.get(inst.arg1) || 0) + 1);
        }
      }
    }

    const newInsts = [];

    for (let i = 0; i < instructions.length; i++) {
      const inst = instructions[i];

      // Instructions with side effects must never be removed
      if (['CALL', 'ARRAY_STORE', 'RETURN', 'PARAM', 'IF_GOTO', 'IF_FALSE_GOTO', 'GOTO', 'LABEL'].includes(inst.op)) {
        newInsts.push(inst);
        continue;
      }

      // Temporaries that are never used can be safely removed
      if (inst.result && inst.result.startsWith('t') && inst.op !== 'ARRAY_LOAD') {
        const count = usageCount.get(inst.result) || 0;
        if (count === 0) {
          this.recordLedger('Dead Code Elimination', `Removed unused temporary assignment to '${inst.result}'`, inst.toString(), null, inst.line);
          changed = true;
          continue;
        }
      }

      newInsts.push(inst);
    }

    return { instructions: newInsts, changed };
  }

  // -------------------------------------------------------------
  // Pass 5: Loop-Invariant Code Motion (LICM)
  // -------------------------------------------------------------

  runLICMPass(instructions, funcName) {
    let changed = false;
    const newInsts = [...instructions];

    // Find loop labels (e.g. L_while_cond, L_for_cond)
    for (let i = 0; i < newInsts.length; i++) {
      if (newInsts[i].op === 'LABEL' && (newInsts[i].result.includes('cond') || newInsts[i].result.includes('while') || newInsts[i].result.includes('for'))) {
        const condLabel = newInsts[i].result;
        // Find corresponding jump back to this label
        let backJumpIdx = -1;
        for (let j = i + 1; j < newInsts.length; j++) {
          if (newInsts[j].op === 'GOTO' && newInsts[j].result === condLabel) {
            backJumpIdx = j;
            break;
          }
        }

        if (backJumpIdx !== -1) {
          // Collect variables written in the loop body
          const writtenVars = new Set();
          for (let k = i + 1; k < backJumpIdx; k++) {
            if (newInsts[k].result) {
              writtenVars.add(newInsts[k].result);
            }
          }

          // Check if any instruction in the loop body uses only invariant variables
          for (let k = i + 1; k < backJumpIdx; k++) {
            const inst = newInsts[k];
            if (['+', '-', '*', '/'].includes(inst.op) && inst.result && inst.result.startsWith('t')) {
              const arg1Invariant = this.isConstant(inst.arg1) || !writtenVars.has(inst.arg1);
              const arg2Invariant = this.isConstant(inst.arg2) || !writtenVars.has(inst.arg2);

              if (arg1Invariant && arg2Invariant) {
                // Hoist instruction to just before the loop condition label (i)
                const [hoisted] = newInsts.splice(k, 1);
                newInsts.splice(i, 0, hoisted);
                this.recordLedger('Loop-Invariant Code Motion', `Hoisted loop-invariant calculation '${hoisted.toString()}' before loop condition '${condLabel}'`, hoisted.toString(), hoisted.toString(), hoisted.line);
                changed = true;
                break;
              }
            }
          }
        }
      }
    }

    return { instructions: newInsts, changed };
  }

  // -------------------------------------------------------------
  // Side-by-Side Diff Generator (LCS Myers-style Diff)
  // -------------------------------------------------------------

  generateDiff(beforeList, afterList) {
    const bStrs = beforeList.map(i => (i ? i.toString().trim() : ''));
    const aStrs = afterList.map(i => (i ? i.toString().trim() : ''));
    const m = bStrs.length;
    const n = aStrs.length;

    // LCS Dynamic Programming table
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (bStrs[i - 1] === aStrs[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to assemble diff tokens
    const rawDiff = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && bStrs[i - 1] === aStrs[j - 1]) {
        rawDiff.push({ before: bStrs[i - 1], after: aStrs[j - 1], status: 'unchanged' });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        rawDiff.push({ before: '', after: aStrs[j - 1], status: 'added' });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        rawDiff.push({ before: bStrs[i - 1], after: '', status: 'removed' });
        i--;
      }
    }
    rawDiff.reverse();

    // Consolidate adjacent removed + added into 'modified'
    const diff = [];
    let lineNum = 1;
    for (let k = 0; k < rawDiff.length; k++) {
      const cur = rawDiff[k];
      const next = rawDiff[k + 1];
      if (cur.status === 'removed' && next && next.status === 'added') {
        diff.push({ line: lineNum++, before: cur.before, after: next.after, status: 'modified' });
        k++;
      } else {
        diff.push({ line: lineNum++, before: cur.before, after: cur.after, status: cur.status });
      }
    }

    return diff;
  }
}

// Export for browser and node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TACOptimizer, OptimizationLedgerEntry };
}

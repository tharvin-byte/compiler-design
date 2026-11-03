/**
 * CompilerLens - Target Code Generator & Peephole Optimizer (codegen.js)
 * Phase 6: Emits assembly instructions for a simple register machine (R0-R7, SP, FP)
 * with register allocation, stack frame conventions, and line-by-line comments.
 * Phase 7: Applies peephole optimizations on target assembly (redundant load/stores,
 * strength reduction, jump-to-next, redundant MOVs) with diffs and savings metrics.
 */

class AssemblyInstruction {
  constructor(op, arg1 = null, arg2 = null, comment = '') {
    this.op = op;             // e.g. MOV, LOAD, STORE, ADD, SUB, MUL, DIV, MOD, CMP, JMP, JE, JNE, JL, JG, CALL, RET, PUSH, POP, PRINT, INPUT, HALT
    this.arg1 = arg1;
    this.arg2 = arg2;
    this.comment = comment;
  }

  toString() {
    if (this.op.endsWith(':')) {
      return `${this.op}`.padEnd(24) + (this.comment ? `; ${this.comment}` : '');
    }
    let line = `  ${this.op}`.padEnd(8);
    if (this.arg1 !== null && this.arg2 !== null) {
      line += `${this.arg1}, ${this.arg2}`;
    } else if (this.arg1 !== null) {
      line += `${this.arg1}`;
    }
    if (this.comment) {
      line = line.padEnd(28) + `; ${this.comment}`;
    }
    return line;
  }
}

class CodeGenerator {
  constructor() {
    this.instructions = [];
    this.registers = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];
    this.varOffsets = new Map();     // varName -> offset from FP (e.g. -4, -8)
    this.nextOffset = -4;
    this.paramOffsets = new Map();   // paramName -> offset from FP (+8, +12, etc.)
    this.currentFunctionName = '';
  }

  generate(optimizedFunctions) {
    this.instructions = [];

    // Header entry point setup
    this.emit('JMP', 'func_main', null, 'jump to main entry point');

    for (const func of optimizedFunctions || []) {
      this.generateFunctionAssembly(func);
    }

    // Target Code Peephole Optimization (Phase 7)
    const peepholeResult = this.optimizePeephole(this.instructions);

    return {
      rawAssembly: this.instructions,
      optimizedAssembly: peepholeResult.instructions,
      diff: peepholeResult.diff,
      savedCount: peepholeResult.savedCount,
      percentage: peepholeResult.percentage,
      rulesApplied: peepholeResult.rulesApplied
    };
  }

  emit(op, arg1 = null, arg2 = null, comment = '') {
    const inst = new AssemblyInstruction(op, arg1, arg2, comment);
    this.instructions.push(inst);
    return inst;
  }

  emitLabel(labelName, comment = '') {
    return this.emit(`${labelName}:`, null, null, comment);
  }

  getVarLocation(name) {
    if (this.paramOffsets.has(name)) {
      return `[FP+${this.paramOffsets.get(name)}]`;
    }
    if (!this.varOffsets.has(name)) {
      this.varOffsets.set(name, this.nextOffset);
      this.nextOffset -= 4;
    }
    return `[FP${this.varOffsets.get(name)}]`;
  }

  isConstant(val) {
    if (val === null || val === undefined) return false;
    if (typeof val === 'number') return true;
    if (typeof val === 'boolean') return true;
    if (typeof val === 'string') {
      return /^-?\d+(\.\d+)?$/.test(val) || val === 'true' || val === 'false' || 
             (val.startsWith('"') && val.endsWith('"')) || 
             (val.startsWith("'") && val.endsWith("'"));
    }
    return false;
  }

  // -------------------------------------------------------------
  // Function Assembly Code Generation
  // -------------------------------------------------------------

  generateFunctionAssembly(func) {
    this.currentFunctionName = func.name;
    this.varOffsets.clear();
    this.nextOffset = -4;
    this.paramOffsets.clear();

    // Map parameters to caller frame offsets: [FP+8], [FP+12], etc.
    // When caller pushes arg: SP decreases by 4.
    // CALL pushes return PC: SP decreases by 4.
    // Function entry PUSH FP: SP decreases by 4.
    // MOV FP, SP makes FP point to saved FP.
    // So [FP+4] is return PC, [FP+8] is first argument, [FP+12] is second argument...
    const params = func.params || [];
    for (let i = 0; i < params.length; i++) {
      this.paramOffsets.set(params[i], 8 + i * 4);
    }

    this.emitLabel(`func_${func.name}`, `enter function ${func.name}`);

    // Function Prologue: PUSH FP; MOV FP, SP; allocate stack frame
    this.emit('PUSH', 'FP', null, 'save previous frame pointer');
    this.emit('MOV', 'FP', 'SP', 'establish new frame pointer');

    // Reserve space on stack for local variables
    const stackAllocInst = this.emit('SUB', 'SP', '0', 'reserve space for locals (patched later)');

    // Translate TAC instructions
    for (const tac of func.instructions) {
      this.translateTAC(tac);
    }

    // Patch stack frame allocation size
    const totalLocalBytes = Math.abs(this.nextOffset + 4);
    stackAllocInst.arg2 = String(totalLocalBytes);
    stackAllocInst.comment = `reserve ${totalLocalBytes} bytes for locals`;

    // Function Epilogue
    this.emitLabel(`exit_${func.name}`, `epilogue for ${func.name}`);
    this.emit('MOV', 'SP', 'FP', 'restore stack pointer');
    this.emit('POP', 'FP', null, 'restore caller frame pointer');
    if (func.name === 'main') {
      this.emit('HALT', null, null, 'terminate program execution');
    } else {
      this.emit('RET', null, null, 'return to caller');
    }
  }

  translateTAC(tac) {
    switch (tac.op) {
      case 'LABEL':
        // Skip duplicate entry label for the current function
        if (tac.result === `func_${this.currentFunctionName}`) {
          break;
        }
        this.emitLabel(tac.result, 'jump target');
        break;

      case '=': {
        // Result = Arg1
        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load immediate ${tac.arg1}`);
        } else {
          const loc = this.getVarLocation(tac.arg1);
          this.emit('LOAD', 'R0', loc, `load variable ${tac.arg1}`);
        }
        const destLoc = this.getVarLocation(tac.result);
        this.emit('STORE', destLoc, 'R0', `assign to ${tac.result}`);
        break;
      }

      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
      case '**': {
        // Binary arithmetic: result = arg1 op arg2
        // Load arg1 into R0
        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load immediate ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load ${tac.arg1}`);
        }

        // Load arg2 into R1
        if (this.isConstant(tac.arg2)) {
          this.emit('MOV', 'R1', tac.arg2, `load immediate ${tac.arg2}`);
        } else {
          this.emit('LOAD', 'R1', this.getVarLocation(tac.arg2), `load ${tac.arg2}`);
        }

        // Arithmetic opcode
        let asmOp = 'ADD';
        if (tac.op === '-') asmOp = 'SUB';
        else if (tac.op === '*') asmOp = 'MUL';
        else if (tac.op === '/') asmOp = 'DIV';
        else if (tac.op === '%') asmOp = 'MOD';
        else if (tac.op === '**') asmOp = 'POW';

        this.emit(asmOp, 'R0', 'R1', `R0 = R0 ${tac.op} R1`);
        this.emit('STORE', this.getVarLocation(tac.result), 'R0', `store result in ${tac.result}`);
        break;
      }

      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=': {
        // Relational operations: R0 = (arg1 op arg2) ? 1 : 0
        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load immediate ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load ${tac.arg1}`);
        }

        if (this.isConstant(tac.arg2)) {
          this.emit('MOV', 'R1', tac.arg2, `load immediate ${tac.arg2}`);
        } else {
          this.emit('LOAD', 'R1', this.getVarLocation(tac.arg2), `load ${tac.arg2}`);
        }

        this.emit('CMP', 'R0', 'R1', `compare ${tac.arg1} with ${tac.arg2}`);

        // Set condition code into R0
        const trueLbl = `L_rel_true_${Math.floor(Math.random()*100000)}`;
        const endLbl = `L_rel_end_${Math.floor(Math.random()*100000)}`;

        let jmpOp = 'JE';
        if (tac.op === '!=') jmpOp = 'JNE';
        else if (tac.op === '<') jmpOp = 'JL';
        else if (tac.op === '<=') jmpOp = 'JLE';
        else if (tac.op === '>') jmpOp = 'JG';
        else if (tac.op === '>=') jmpOp = 'JGE';

        this.emit(jmpOp, trueLbl, null, `branch if condition true`);
        this.emit('MOV', 'R0', '0', 'set false (0)');
        this.emit('JMP', endLbl, null, 'skip true branch');
        this.emitLabel(trueLbl);
        this.emit('MOV', 'R0', '1', 'set true (1)');
        this.emitLabel(endLbl);

        this.emit('STORE', this.getVarLocation(tac.result), 'R0', `store boolean result in ${tac.result}`);
        break;
      }

      case '&&': {
        const falseLbl = `L_and_false_${Math.floor(Math.random()*100000)}`;
        const endLbl = `L_and_end_${Math.floor(Math.random()*100000)}`;

        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load ${tac.arg1}`);
        }
        this.emit('CMP', 'R0', '0', 'check left operand of &&');
        this.emit('JE', falseLbl, null, 'short-circuit if false');

        if (this.isConstant(tac.arg2)) {
          this.emit('MOV', 'R0', tac.arg2, `load ${tac.arg2}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg2), `load ${tac.arg2}`);
        }
        this.emit('CMP', 'R0', '0', 'check right operand of &&');
        this.emit('JE', falseLbl, null, 'jump if right operand is false');

        this.emit('MOV', 'R0', '1', 'both true -> 1');
        this.emit('JMP', endLbl, null, 'skip false label');
        this.emitLabel(falseLbl);
        this.emit('MOV', 'R0', '0', 'either false -> 0');
        this.emitLabel(endLbl);
        this.emit('STORE', this.getVarLocation(tac.result), 'R0', `store logical AND result in ${tac.result}`);
        break;
      }

      case '||': {
        const trueLbl = `L_or_true_${Math.floor(Math.random()*100000)}`;
        const endLbl = `L_or_end_${Math.floor(Math.random()*100000)}`;

        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load ${tac.arg1}`);
        }
        this.emit('CMP', 'R0', '0', 'check left operand of ||');
        this.emit('JNE', trueLbl, null, 'short-circuit if true');

        if (this.isConstant(tac.arg2)) {
          this.emit('MOV', 'R0', tac.arg2, `load ${tac.arg2}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg2), `load ${tac.arg2}`);
        }
        this.emit('CMP', 'R0', '0', 'check right operand of ||');
        this.emit('JNE', trueLbl, null, 'jump if right operand is true');

        this.emit('MOV', 'R0', '0', 'both false -> 0');
        this.emit('JMP', endLbl, null, 'skip true label');
        this.emitLabel(trueLbl);
        this.emit('MOV', 'R0', '1', 'either true -> 1');
        this.emitLabel(endLbl);
        this.emit('STORE', this.getVarLocation(tac.result), 'R0', `store logical OR result in ${tac.result}`);
        break;
      }

      case '!': {
        const trueLbl = `L_not_true_${Math.floor(Math.random()*100000)}`;
        const endLbl = `L_not_end_${Math.floor(Math.random()*100000)}`;

        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load ${tac.arg1}`);
        }
        this.emit('CMP', 'R0', '0', 'test ! operand');
        this.emit('JE', trueLbl, null, '0 -> true');
        this.emit('MOV', 'R0', '0', 'non-zero -> false (0)');
        this.emit('JMP', endLbl, null, 'skip true branch');
        this.emitLabel(trueLbl);
        this.emit('MOV', 'R0', '1', 'zero -> true (1)');
        this.emitLabel(endLbl);
        this.emit('STORE', this.getVarLocation(tac.result), 'R0', `store logical NOT result in ${tac.result}`);
        break;
      }

      case 'NEG': {
        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load ${tac.arg1}`);
        }
        this.emit('MOV', 'R1', '0', 'R1 = 0');
        this.emit('SUB', 'R1', 'R0', 'R1 = 0 - R0 (negation)');
        this.emit('STORE', this.getVarLocation(tac.result), 'R1', `store negation in ${tac.result}`);
        break;
      }

      case 'GOTO':
        this.emit('JMP', tac.result, null, `unconditional jump to ${tac.result}`);
        break;

      case 'IF_GOTO':
        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load condition ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load condition ${tac.arg1}`);
        }
        this.emit('CMP', 'R0', '0', 'test condition');
        this.emit('JNE', tac.result, null, `branch if condition != 0 to ${tac.result}`);
        break;

      case 'IF_FALSE_GOTO':
        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load condition ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load condition ${tac.arg1}`);
        }
        this.emit('CMP', 'R0', '0', 'test condition');
        this.emit('JE', tac.result, null, `branch if condition == 0 to ${tac.result}`);
        break;

      case 'PARAM':
        if (this.isConstant(tac.arg1)) {
          this.emit('MOV', 'R0', tac.arg1, `load param ${tac.arg1}`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load param ${tac.arg1}`);
        }
        this.emit('PUSH', 'R0', null, `push argument onto call stack`);
        break;

      case 'CALL': {
        const callee = tac.arg1;
        const argCount = parseInt(tac.arg2, 10) || 0;

        if (callee === 'puts' || callee === 'print' || callee === 'printf') {
          if (argCount <= 1) {
            this.emit('POP', 'R0', null, 'pop value to output');
            this.emit(callee === 'puts' ? 'PUTS' : 'PRINT', 'R0', null, `${callee} console output`);
          } else {
            for (let i = argCount - 1; i >= 0; i--) {
              this.emit('POP', `R${i % 8}`, null, `pop argument ${i}`);
            }
            this.emit(callee === 'puts' ? 'PUTS' : 'PRINT', 'R0', null, `${callee} console output`);
          }
          break;
        }

        if (callee === 'gets' || callee === 'scanf' || callee === 'input') {
          this.emit('INPUT', 'R0', null, 'read input');
          if (tac.result) {
            this.emit('STORE', this.getVarLocation(tac.result), 'R0', `save input into ${tac.result}`);
          }
          break;
        }

        if (callee === 'to_i' || callee === 'to_f') {
          if (argCount >= 1) {
            this.emit('POP', 'R0', null, 'pop value to convert');
          }
          if (tac.result) {
            this.emit('STORE', this.getVarLocation(tac.result), 'R0', `store converted value into ${tac.result}`);
          }
          break;
        }

        this.emit('CALL', `func_${callee}`, null, `invoke function ${callee}`);

        // Clean up pushed arguments from caller stack: ADD SP, 4 * argCount
        if (argCount > 0) {
          this.emit('ADD', 'SP', String(argCount * 4), `clean up ${argCount} args from stack`);
        }

        // Return value is in R0
        if (tac.result) {
          this.emit('STORE', this.getVarLocation(tac.result), 'R0', `store return value into ${tac.result}`);
        }
        break;
      }

      case 'RETURN':
        if (tac.arg1 !== null) {
          if (this.isConstant(tac.arg1)) {
            this.emit('MOV', 'R0', tac.arg1, `load return value ${tac.arg1}`);
          } else {
            this.emit('LOAD', 'R0', this.getVarLocation(tac.arg1), `load return value ${tac.arg1}`);
          }
        }
        this.emit('JMP', `exit_${this.currentFunctionName}`, null, 'jump to epilogue');
        break;

      case 'ARRAY_STORE': {
        // array[index] = val
        const arrName = tac.arg1;
        const idxVal = tac.arg2;
        const val = tac.result;

        if (this.isConstant(val)) {
          this.emit('MOV', 'R0', val, `load value to store`);
        } else {
          this.emit('LOAD', 'R0', this.getVarLocation(val), `load value to store`);
        }

        if (this.isConstant(idxVal)) {
          this.emit('MOV', 'R1', idxVal, `array index ${idxVal}`);
        } else {
          this.emit('LOAD', 'R1', this.getVarLocation(idxVal), `load array index`);
        }

        this.emit('STORE', `[${arrName}+R1]`, 'R0', `store into ${arrName}[index]`);
        break;
      }

      case 'ARRAY_LOAD': {
        // result = array[index]
        const arrName = tac.arg1;
        const idxVal = tac.arg2;
        const resultVar = tac.result;

        if (this.isConstant(idxVal)) {
          this.emit('MOV', 'R1', idxVal, `array index ${idxVal}`);
        } else {
          this.emit('LOAD', 'R1', this.getVarLocation(idxVal), `load array index`);
        }

        this.emit('LOAD', 'R0', `[${arrName}+R1]`, `load from ${arrName}[index]`);
        this.emit('STORE', this.getVarLocation(resultVar), 'R0', `save into ${resultVar}`);
        break;
      }
    }
  }

  // -------------------------------------------------------------
  // Phase 7: Peephole Optimizer
  // -------------------------------------------------------------

  optimizePeephole(instructions) {
    let current = instructions.map(i => new AssemblyInstruction(i.op, i.arg1, i.arg2, i.comment));
    const rulesApplied = [];
    let changed = true;
    let passes = 0;

    while (changed && passes < 10) {
      changed = false;
      passes++;
      const nextInsts = [];

      for (let i = 0; i < current.length; i++) {
        const inst = current[i];
        const next = i + 1 < current.length ? current[i + 1] : null;

        // Rule 1: Redundant STORE followed by immediate LOAD of same memory and register
        // STORE [addr], Rx followed by LOAD Rx, [addr] -> redundant LOAD
        if (next && inst.op === 'STORE' && next.op === 'LOAD') {
          if (inst.arg1 === next.arg2 && inst.arg2 === next.arg1) {
            nextInsts.push(inst);
            rulesApplied.push({
              rule: 'Redundant Load Elimination',
              description: `Removed redundant '${next.toString().trim()}' immediately following '${inst.toString().trim()}'`,
              line: i + 1
            });
            i++; // skip next
            changed = true;
            continue;
          }
        }

        // Rule 2: Redundant MOV Rx, Rx
        if (inst.op === 'MOV' && inst.arg1 === inst.arg2) {
          rulesApplied.push({
            rule: 'Self-Move Elimination',
            description: `Removed redundant self-assignment '${inst.toString().trim()}'`,
            line: i + 1
          });
          changed = true;
          continue;
        }

        // Rule 3: Strength Reduction: MUL Rx, 2 -> ADD Rx, Rx
        if (inst.op === 'MUL' && (inst.arg2 === '2' || inst.arg2 === 2)) {
          rulesApplied.push({
            rule: 'Strength Reduction',
            description: `Replaced multiplication by 2 with faster addition '${inst.arg1} + ${inst.arg1}'`,
            line: i + 1
          });
          nextInsts.push(new AssemblyInstruction('ADD', inst.arg1, inst.arg1, 'strength-reduced x*2 -> x+x'));
          changed = true;
          continue;
        }

        // Rule 4: ADD Rx, 0 or SUB Rx, 0 -> remove instruction
        if ((inst.op === 'ADD' || inst.op === 'SUB') && (inst.arg2 === '0' || inst.arg2 === 0)) {
          rulesApplied.push({
            rule: 'Identity Arithmetic Elimination',
            description: `Removed no-op '${inst.toString().trim()}'`,
            line: i + 1
          });
          changed = true;
          continue;
        }

        // Rule 5: Jump to next instruction: JMP L_target followed immediately by L_target:
        if (next && inst.op === 'JMP') {
          const targetLabel = inst.arg1 + ':';
          if (next.op === targetLabel) {
            rulesApplied.push({
              rule: 'Redundant Jump Removal',
              description: `Removed redundant branch to immediately succeeding label '${inst.arg1}'`,
              line: i + 1
            });
            changed = true;
            continue; // drop the JMP instruction
          }
        }

        nextInsts.push(inst);
      }

      current = nextInsts;
    }

    const savedCount = instructions.length - current.length;
    const percentage = instructions.length > 0 ? ((savedCount / instructions.length) * 100).toFixed(1) : 0;

    // Diff comparison (LCS Myers-style Diff)
    const bStrs = instructions.map(i => (i ? i.toString().trim() : ''));
    const aStrs = current.map(i => (i ? i.toString().trim() : ''));
    const m = bStrs.length;
    const n = aStrs.length;

    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let r = 1; r <= m; r++) {
      for (let c = 1; c <= n; c++) {
        if (bStrs[r - 1] === aStrs[c - 1]) {
          dp[r][c] = dp[r - 1][c - 1] + 1;
        } else {
          dp[r][c] = Math.max(dp[r - 1][c], dp[r][c - 1]);
        }
      }
    }

    const rawDiff = [];
    let r = m, c = n;
    while (r > 0 || c > 0) {
      if (r > 0 && c > 0 && bStrs[r - 1] === aStrs[c - 1]) {
        rawDiff.push({ before: bStrs[r - 1], after: aStrs[c - 1], status: 'unchanged' });
        r--;
        c--;
      } else if (c > 0 && (r === 0 || dp[r][c - 1] >= dp[r - 1][c])) {
        rawDiff.push({ before: '', after: aStrs[c - 1], status: 'added' });
        c--;
      } else if (r > 0 && (c === 0 || dp[r][c - 1] < dp[r - 1][c])) {
        rawDiff.push({ before: bStrs[r - 1], after: '', status: 'removed' });
        r--;
      }
    }
    rawDiff.reverse();

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

    return {
      instructions: current,
      diff,
      savedCount,
      percentage,
      rulesApplied
    };
  }
}

// Export for browser and node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CodeGenerator, AssemblyInstruction };
}

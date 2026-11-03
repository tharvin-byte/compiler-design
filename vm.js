/**
 * CompilerLens - Virtual Machine & Dual-Execution Engine (vm.js)
 * Phase 8 / Execution: Emulates the target register machine (R0-R7, SP, FP, PC, Memory, Stack),
 * provides step-by-step interactive visualizer hooks, enforces an infinite loop guard
 * (~1,000,000 instruction watchdog), and includes an independent AST Reference Interpreter
 * for dual-run behavioral validation ("Verified ✓").
 */

class VirtualMachine {
  constructor(options = {}) {
    this.maxInstructions = options.maxInstructions || 1000000;
    this.onOutput = options.onOutput || null;
    this.onInputRequired = options.onInputRequired || null;
    this.onStep = options.onStep || null;
    this.onHalt = options.onHalt || null;
    this.onError = options.onError || null;

    // Registers
    this.registers = {
      R0: 0, R1: 0, R2: 0, R3: 0,
      R4: 0, R5: 0, R6: 0, R7: 0
    };
    this.PC = 0;               // Program Counter
    this.stackBase = 8000;
    this.SP = this.stackBase;  // Stack Pointer (grows downward from 8000)
    this.FP = this.stackBase;  // Frame Pointer
    this.flags = { zero: false, sign: false };

    // Memory buffer (linear memory array of 10,000 words)
    this.memorySize = 10000;
    this.memory = new Array(this.memorySize).fill(0);
    this.arrays = new Map();   // arrayName -> memory base address (in heap area: 200..1000)

    // Dynamic execution state
    this.instructions = [];
    this.labels = new Map();
    this.callStack = [];       // Visual call stack: [{ funcName, fp, returnPC }]
    this.outputBuffer = [];
    this.stepCount = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.isHalted = false;
    this.waitingForInput = false;
    this.pendingInputReg = null;
    this.timerId = null;
    this.speed = 50;           // ms per step in auto-play
    this.startTime = 0;
    this.endTime = 0;
    this.stats = {
      instructionsExecuted: 0,
      executionTimeMs: 0,
      exitCode: 0
    };
  }

  load(assemblyInstructions) {
    this.reset();
    this.instructions = assemblyInstructions || [];
    this.labels.clear();

    // Map labels to instruction indices
    for (let i = 0; i < this.instructions.length; i++) {
      const inst = this.instructions[i];
      if (inst.op.endsWith(':')) {
        const lblName = inst.op.slice(0, -1);
        this.labels.set(lblName, i);
      }
    }

    return this;
  }

  reset() {
    this.stopTimer();
    this.registers = {
      R0: 0, R1: 0, R2: 0, R3: 0,
      R4: 0, R5: 0, R6: 0, R7: 0
    };
    this.PC = 0;
    this.SP = this.stackBase;
    this.FP = this.stackBase;
    this.flags = { zero: false, sign: false };
    this.memory.fill(0);
    this.arrays.clear();
    this.callStack = [];
    this.outputBuffer = [];
    this.stepCount = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.isHalted = false;
    this.waitingForInput = false;
    this.pendingInputReg = null;
    this.stats = {
      instructionsExecuted: 0,
      executionTimeMs: 0,
      exitCode: 0
    };
  }

  stopTimer() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  // -------------------------------------------------------------
  // Execution Control (Run, Step, Pause, Auto-Play)
  // -------------------------------------------------------------

  runSynchronous() {
    this.startTime = performance.now();
    this.isRunning = true;
    this.isHalted = false;

    while (!this.isHalted && !this.waitingForInput && this.PC < this.instructions.length) {
      if (this.stepCount >= this.maxInstructions) {
        this.triggerError(`Execution stopped: possible infinite loop (exceeded ${this.maxInstructions.toLocaleString()} instructions).`);
        return this.getResult();
      }
      this.stepInternal();
    }

    this.endTime = performance.now();
    this.stats.executionTimeMs = Math.round((this.endTime - this.startTime) * 100) / 100;
    this.stats.instructionsExecuted = this.stepCount;
    this.stats.exitCode = this.registers.R0;

    return this.getResult();
  }

  startAutoPlay(speedMs = 50) {
    if (this.isHalted || this.PC >= this.instructions.length) {
      this.reset();
    }
    this.speed = speedMs;
    this.isRunning = true;
    this.isPaused = false;
    if (this.stepCount === 0) {
      this.startTime = performance.now();
    }

    const tick = () => {
      if (!this.isRunning || this.isPaused || this.isHalted || this.waitingForInput) {
        return;
      }

      this.step();

      if (!this.isHalted && !this.waitingForInput && this.isRunning) {
        this.timerId = setTimeout(tick, this.speed);
      }
    };

    this.timerId = setTimeout(tick, this.speed);
  }

  pause() {
    this.isPaused = true;
    this.isRunning = false;
    this.stopTimer();
  }

  step() {
    if (this.isHalted || this.PC >= this.instructions.length) {
      this.reset();
    }
    if (this.waitingForInput) {
      return this.getResult();
    }

    if (this.stepCount >= this.maxInstructions) {
      this.triggerError(`Execution stopped: possible infinite loop (exceeded ${this.maxInstructions.toLocaleString()} instructions).`);
      return this.getResult();
    }

    const currentInstIndex = this.PC;
    this.stepInternal();

    if (this.onStep) {
      this.onStep({
        currentInstIndex,
        nextInstIndex: this.PC,
        instruction: this.instructions[currentInstIndex],
        vm: this
      });
    }

    if (this.isHalted && this.onHalt) {
      this.endTime = performance.now();
      this.stats.executionTimeMs = Math.round((this.endTime - this.startTime) * 100) / 100;
      this.stats.instructionsExecuted = this.stepCount;
      this.stats.exitCode = this.registers.R0;
      this.onHalt(this.getResult());
    }

    return this.getResult();
  }

  provideInput(val) {
    const num = parseInt(val, 10);
    const resolvedVal = isNaN(num) ? 0 : num;
    if (this.pendingInputReg) {
      this.registers[this.pendingInputReg] = resolvedVal;
      this.pendingInputReg = null;
    }
    this.waitingForInput = false;

    if (this.isRunning) {
      this.startAutoPlay(this.speed);
    }
  }

  // -------------------------------------------------------------
  // Step Internal Instruction Interpreter
  // -------------------------------------------------------------

  stepInternal() {
    if (this.PC >= this.instructions.length) {
      this.isHalted = true;
      return;
    }

    const inst = this.instructions[this.PC];
    this.PC++;
    this.stepCount++;

    // Skip label declarations
    if (inst.op.endsWith(':')) {
      const lblName = inst.op.slice(0, -1);
      if (lblName.startsWith('func_') && !lblName.startsWith('func_main')) {
        const funcName = lblName.slice(5);
        this.callStack.push({ funcName, fp: this.FP, returnPC: this.PC });
      }
      return;
    }

    const op = inst.op;
    const a1 = inst.arg1;
    const a2 = inst.arg2;

    switch (op) {
      case 'MOV': {
        const val = this.resolveValue(a2);
        if (a1 in this.registers) {
          this.registers[a1] = val;
        } else if (a1 === 'FP') {
          this.FP = val;
        } else if (a1 === 'SP') {
          this.SP = val;
        }
        break;
      }

      case 'LOAD': {
        const addr = this.resolveAddress(a2);
        this.registers[a1] = this.memory[addr] || 0;
        break;
      }

      case 'STORE': {
        const addr = this.resolveAddress(a1);
        const val = this.resolveValue(a2);
        this.memory[addr] = val;
        break;
      }

      case 'ADD': {
        const v1 = this.resolveValue(a1);
        const v2 = this.resolveValue(a2);
        if (a1 in this.registers) {
          if (typeof v1 === 'string' || typeof v2 === 'string') {
            this.registers[a1] = `${v1}${v2}`;
          } else {
            this.registers[a1] = v1 + v2;
          }
        } else if (a1 === 'SP') {
          this.SP += v2;
        }
        break;
      }

      case 'SUB': {
        const v1 = this.resolveValue(a1);
        const v2 = this.resolveValue(a2);
        if (a1 in this.registers) {
          this.registers[a1] = v1 - v2;
        } else if (a1 === 'SP') {
          this.SP -= v2;
        }
        break;
      }

      case 'MUL': {
        const v1 = this.resolveValue(a1);
        const v2 = this.resolveValue(a2);
        if (typeof v1 === 'string' && typeof v2 === 'number') {
          this.registers[a1] = v1.repeat(Math.max(0, v2));
        } else {
          this.registers[a1] = v1 * v2;
        }
        break;
      }

      case 'POW': {
        const v1 = this.resolveValue(a1);
        const v2 = this.resolveValue(a2);
        this.registers[a1] = Math.pow(v1, v2);
        break;
      }

      case 'DIV': {
        const v1 = this.resolveValue(a1);
        const v2 = this.resolveValue(a2);
        if (v2 === 0) {
          this.triggerError(`Runtime Error: Division by zero at instruction ${this.PC - 1}.`);
          return;
        }
        this.registers[a1] = Math.trunc(v1 / v2);
        break;
      }

      case 'MOD': {
        const v1 = this.resolveValue(a1);
        const v2 = this.resolveValue(a2);
        if (v2 === 0) {
          this.triggerError(`Runtime Error: Modulo by zero at instruction ${this.PC - 1}.`);
          return;
        }
        this.registers[a1] = v1 % v2;
        break;
      }

      case 'CMP': {
        const v1 = this.resolveValue(a1);
        const v2 = this.resolveValue(a2);
        this.flags.zero = (v1 === v2);
        this.flags.sign = (v1 < v2);
        break;
      }

      case 'JMP': {
        const targetPC = this.labels.get(a1);
        if (targetPC !== undefined) {
          this.PC = targetPC;
        } else {
          this.triggerError(`Runtime Error: Jump to undefined label '${a1}'.`);
        }
        break;
      }

      case 'JE': {
        if (this.flags.zero) {
          const targetPC = this.labels.get(a1);
          if (targetPC !== undefined) this.PC = targetPC;
        }
        break;
      }

      case 'JNE': {
        if (!this.flags.zero) {
          const targetPC = this.labels.get(a1);
          if (targetPC !== undefined) this.PC = targetPC;
        }
        break;
      }

      case 'JL': {
        if (this.flags.sign && !this.flags.zero) {
          const targetPC = this.labels.get(a1);
          if (targetPC !== undefined) this.PC = targetPC;
        }
        break;
      }

      case 'JLE': {
        if (this.flags.sign || this.flags.zero) {
          const targetPC = this.labels.get(a1);
          if (targetPC !== undefined) this.PC = targetPC;
        }
        break;
      }

      case 'JG': {
        if (!this.flags.sign && !this.flags.zero) {
          const targetPC = this.labels.get(a1);
          if (targetPC !== undefined) this.PC = targetPC;
        }
        break;
      }

      case 'JGE': {
        if (!this.flags.sign || this.flags.zero) {
          const targetPC = this.labels.get(a1);
          if (targetPC !== undefined) this.PC = targetPC;
        }
        break;
      }

      case 'PUSH': {
        const val = this.resolveValue(a1);
        this.SP -= 4;
        if (this.SP < 1000) {
          this.triggerError(`Runtime Error: Stack Overflow.`);
          return;
        }
        this.memory[this.SP] = val;
        break;
      }

      case 'POP': {
        const val = this.memory[this.SP];
        this.SP += 4;
        if (a1 in this.registers) {
          this.registers[a1] = val;
        } else if (a1 === 'FP') {
          this.FP = val;
        }
        break;
      }

      case 'CALL': {
        // Save return PC on stack
        this.SP -= 4;
        this.memory[this.SP] = this.PC;
        const targetPC = this.labels.get(a1);
        if (targetPC !== undefined) {
          this.PC = targetPC;
        } else {
          this.triggerError(`Runtime Error: Call to undefined label '${a1}'.`);
        }
        break;
      }

      case 'RET': {
        this.PC = this.memory[this.SP];
        this.SP += 4;
        if (this.callStack.length > 0) {
          this.callStack.pop();
        }
        break;
      }

      case 'PUTS':
      case 'PRINT': {
        let val = this.resolveValue(a1);
        if (typeof val === 'string' && /%[dsf]/.test(val)) {
          let regIdx = 1;
          val = val.replace(/%[dsf]/g, () => {
            const v = this.registers[`R${regIdx}`] !== undefined ? this.registers[`R${regIdx}`] : '';
            regIdx++;
            return v;
          });
        }
        this.outputBuffer.push(val);
        if (this.onOutput) {
          this.onOutput(val);
        }
        break;
      }

      case 'INPUT': {
        this.waitingForInput = true;
        this.pendingInputReg = a1;
        if (this.onInputRequired) {
          this.onInputRequired();
        }
        break;
      }

      case 'HALT': {
        this.isHalted = true;
        this.isRunning = false;
        this.stopTimer();
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------
  // Resolvers & Address Calculations
  // -------------------------------------------------------------

  resolveValue(arg) {
    if (arg === null || arg === undefined) return 0;
    if (typeof arg === 'number') return arg;
    if (typeof arg === 'boolean') return arg ? 1 : 0;
    if (arg in this.registers) return this.registers[arg];
    if (arg === 'SP') return this.SP;
    if (arg === 'FP') return this.FP;
    if (typeof arg === 'string') {
      if (arg.startsWith('"') && arg.endsWith('"')) {
        try {
          return JSON.parse(arg);
        } catch (_) {
          return arg.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        }
      }
      if (arg.startsWith("'") && arg.endsWith("'")) {
        return arg.slice(1, -1).charCodeAt(0);
      }
      if (arg === 'true') return 1;
      if (arg === 'false') return 0;
      if (arg.startsWith('[') && arg.endsWith(']')) {
        const addr = this.resolveAddress(arg);
        return this.memory[addr] || 0;
      }
      const parsed = parseInt(arg, 10);
      return isNaN(parsed) ? arg : parsed;
    }
    return arg;
  }

  resolveAddress(arg) {
    if (!arg.startsWith('[') || !arg.endsWith(']')) {
      return parseInt(arg, 10) || 0;
    }

    const inner = arg.slice(1, -1);

    // [FP+8] or [FP-4]
    if (inner.startsWith('FP')) {
      const offset = parseInt(inner.slice(2), 10) || 0;
      const addr = this.FP + offset;
      if (addr < 0 || addr >= this.memorySize) {
        this.triggerError(`Runtime Error: Stack memory address out of bounds (${addr}).`);
      }
      return addr;
    }

    // [arrName+R1]
    if (inner.includes('+')) {
      const [arrName, reg] = inner.split('+');
      if (!this.arrays.has(arrName)) {
        // Assign base address for array in static memory area
        const baseAddr = 200 + this.arrays.size * 100;
        this.arrays.set(arrName, baseAddr);
      }
      const base = this.arrays.get(arrName);
      const idx = this.resolveValue(reg);
      if (idx < 0 || idx >= 100) {
        this.triggerError(`Runtime Error: Array index out of bounds [${idx}] for array '${arrName}'.`);
      }
      return base + idx;
    }

    return parseInt(inner, 10) || 0;
  }

  triggerError(msg) {
    this.isHalted = true;
    this.isRunning = false;
    this.lastError = msg;
    this.stopTimer();
    this.outputBuffer.push(`[ERROR] ${msg}`);
    if (this.onError) {
      this.onError(msg);
    }
  }

  getResult() {
    return {
      output: this.outputBuffer,
      outputString: this.outputBuffer.join('\n'),
      registers: { ...this.registers },
      PC: this.PC,
      SP: this.SP,
      FP: this.FP,
      flags: { ...this.flags },
      stats: {
        instructionsExecuted: this.stepCount,
        executionTimeMs: this.stats.executionTimeMs,
        exitCode: this.registers.R0,
        error: this.lastError || null
      },
      isHalted: this.isHalted,
      callStack: [...this.callStack]
    };
  }
}

// -------------------------------------------------------------
// AST Reference Interpreter (Self-Test / Verification Engine)
// -------------------------------------------------------------

class ASTInterpreter {
  constructor() {
    this.outputBuffer = [];
    this.functions = new Map();
    this.globals = new Map();
    this.stepCount = 0;
    this.maxSteps = 100000;
  }

  run(ast) {
    this.outputBuffer = [];
    this.functions.clear();
    this.globals.clear();
    this.stepCount = 0;

    if (!ast) return { output: [], outputString: '', verified: false };

    // Register top-level functions and globals
    for (const decl of ast.declarations || []) {
      if (decl.type === 'FunctionDeclaration') {
        this.functions.set(decl.name, decl);
      } else if (decl.type === 'VariableDeclaration') {
        for (const v of decl.declarations || []) {
          this.globals.set(v.id.name, v.init ? this.evalExpr(v.init, this.globals) : 0);
        }
      } else if (decl.type === 'ArrayDeclaration') {
        const arr = (decl.elements || []).map(e => this.evalExpr(e, this.globals));
        this.globals.set(decl.name, arr);
      }
    }

    const mainFunc = this.functions.get('main');
    if (!mainFunc) {
      // Evaluate top-level statements directly if main() is omitted
      try {
        for (const decl of ast.declarations || []) {
          if (decl.type !== 'FunctionDeclaration') {
            this.evalStmt(decl, this.globals);
          }
        }
        return {
          output: this.outputBuffer,
          outputString: this.outputBuffer.join('\n'),
          verified: true
        };
      } catch (err) {
        return {
          output: this.outputBuffer,
          outputString: this.outputBuffer.join('\n'),
          verified: false,
          error: err.message
        };
      }
    }

    try {
      this.evalFunction(mainFunc, []);
      return {
        output: this.outputBuffer,
        outputString: this.outputBuffer.join('\n'),
        verified: true
      };
    } catch (err) {
      return {
        output: this.outputBuffer,
        outputString: this.outputBuffer.join('\n'),
        verified: false,
        error: err.message
      };
    }
  }

  evalFunction(funcNode, argValues) {
    const scope = new Map(this.globals);

    // Bind parameters
    const params = funcNode.params || [];
    for (let i = 0; i < params.length; i++) {
      scope.set(params[i].name, argValues[i] !== undefined ? argValues[i] : 0);
    }

    const res = this.evalBlock(funcNode.body, scope);
    if (res && res.isReturn) {
      return res.value;
    }
    return 0;
  }

  evalBlock(blockNode, scope) {
    for (const stmt of blockNode.statements || []) {
      this.stepCount++;
      if (this.stepCount > this.maxSteps) {
        throw new Error('AST interpreter step limit reached');
      }

      const res = this.evalStmt(stmt, scope);
      if (res && res.isReturn) {
        return res;
      }
      if (res && (res.isBreak || res.isContinue)) {
        return res;
      }
    }
    return null;
  }

  evalStmt(stmt, scope) {
    if (!stmt) return null;

    switch (stmt.type) {
      case 'BlockStatement':
        return this.evalBlock(stmt, scope);

      case 'VariableDeclaration':
        for (const decl of stmt.declarations || []) {
          const val = decl.init ? this.evalExpr(decl.init, scope) : 0;
          scope.set(decl.id.name, val);
        }
        return null;

      case 'ArrayDeclaration': {
        const arr = (stmt.elements || []).map(e => this.evalExpr(e, scope));
        scope.set(stmt.name, arr);
        return null;
      }

      case 'ExpressionStatement':
        if (stmt.expression) {
          this.evalExpr(stmt.expression, scope);
        }
        return null;

      case 'IfStatement': {
        const cond = this.evalExpr(stmt.condition, scope);
        if (cond) {
          return this.evalStmt(stmt.thenBranch, scope);
        } else if (stmt.elsifBranches && stmt.elsifBranches.length > 0) {
          for (const elsif of stmt.elsifBranches) {
            if (this.evalExpr(elsif.condition, scope)) {
              return this.evalStmt(elsif.body, scope);
            }
          }
        }
        if (stmt.elseBranch) {
          return this.evalStmt(stmt.elseBranch, scope);
        }
        return null;
      }

      case 'WhileStatement': {
        while (this.evalExpr(stmt.condition, scope)) {
          this.stepCount++;
          if (this.stepCount > this.maxSteps) throw new Error('Infinite loop');
          const res = this.evalStmt(stmt.body, scope);
          if (res && res.isReturn) return res;
          if (res && res.isBreak) break;
        }
        return null;
      }

      case 'DoWhileStatement': {
        do {
          this.stepCount++;
          if (this.stepCount > this.maxSteps) throw new Error('Infinite loop');
          const res = this.evalStmt(stmt.body, scope);
          if (res && res.isReturn) return res;
          if (res && res.isBreak) break;
        } while (this.evalExpr(stmt.condition, scope));
        return null;
      }

      case 'ForStatement': {
        if (stmt.init) {
          if (stmt.init.type === 'VariableDeclaration') {
            this.evalStmt(stmt.init, scope);
          } else {
            this.evalExpr(stmt.init, scope);
          }
        }

        while (!stmt.condition || this.evalExpr(stmt.condition, scope)) {
          this.stepCount++;
          if (this.stepCount > this.maxSteps) throw new Error('Infinite loop');
          const res = this.evalStmt(stmt.body, scope);
          if (res && res.isReturn) return res;
          if (res && res.isBreak) break;
          if (stmt.step) this.evalExpr(stmt.step, scope);
        }
        return null;
      }

      case 'ReturnStatement':
        return { isReturn: true, value: stmt.argument ? this.evalExpr(stmt.argument, scope) : 0 };

      case 'BreakStatement':
        return { isBreak: true };

      case 'ContinueStatement':
        return { isContinue: true };

      default:
        return null;
    }
  }

  evalExpr(expr, scope) {
    if (!expr) return 0;

    switch (expr.type) {
      case 'Literal':
        return expr.value;

      case 'Identifier':
        return scope.has(expr.name) ? scope.get(expr.name) : (this.globals.get(expr.name) || 0);

      case 'BinaryExpression': {
        const left = this.evalExpr(expr.left, scope);
        const right = this.evalExpr(expr.right, scope);
        switch (expr.operator) {
          case '+':
            if (typeof left === 'string' || typeof right === 'string') {
              return String(left) + String(right);
            }
            return left + right;
          case '-': return left - right;
          case '*':
            if (typeof left === 'string' && typeof right === 'number') {
              return left.repeat(Math.max(0, Math.floor(right)));
            }
            return left * right;
          case '/': return right !== 0 ? Math.trunc(left / right) : 0;
          case '%': return right !== 0 ? left % right : 0;
          case '**': return Math.pow(left, right);
          case '==': return left === right ? 1 : 0;
          case '!=': return left !== right ? 1 : 0;
          case '<':  return left < right ? 1 : 0;
          case '<=': return left <= right ? 1 : 0;
          case '>':  return left > right ? 1 : 0;
          case '>=': return left >= right ? 1 : 0;
          default: return 0;
        }
      }

      case 'LogicalExpression': {
        const left = this.evalExpr(expr.left, scope);
        if (expr.operator === '&&') return left ? this.evalExpr(expr.right, scope) : 0;
        if (expr.operator === '||') return left ? 1 : (this.evalExpr(expr.right, scope) ? 1 : 0);
        return 0;
      }

      case 'UnaryExpression': {
        const val = this.evalExpr(expr.argument, scope);
        return expr.operator === '-' ? -val : (expr.operator === '!' ? (val ? 0 : 1) : val);
      }

      case 'UpdateExpression': {
        const cur = scope.has(expr.argument.name) ? scope.get(expr.argument.name) : 0;
        const delta = expr.operator === '++' ? 1 : -1;
        scope.set(expr.argument.name, cur + delta);
        return expr.prefix ? (cur + delta) : cur;
      }

      case 'AssignmentExpression': {
        const rightVal = this.evalExpr(expr.right, scope);
        if (expr.left.type === 'Identifier') {
          let finalVal = rightVal;
          if (expr.operator !== '=') {
            const cur = scope.has(expr.left.name) ? scope.get(expr.left.name) : (this.globals.get(expr.left.name) || 0);
            const op = expr.operator.slice(0, -1);
            if (op === '+') finalVal = (typeof cur === 'string' || typeof rightVal === 'string') ? String(cur) + String(rightVal) : cur + rightVal;
            else if (op === '-') finalVal = cur - rightVal;
            else if (op === '*') finalVal = cur * rightVal;
            else if (op === '/') finalVal = rightVal !== 0 ? Math.trunc(cur / rightVal) : 0;
            else if (op === '**') finalVal = Math.pow(cur, rightVal);
          }
          scope.set(expr.left.name, finalVal);
          this.globals.set(expr.left.name, finalVal);
          return finalVal;
        } else if (expr.left.type === 'ArrayAccess') {
          const arr = scope.get(expr.left.array.name);
          const idx = this.evalExpr(expr.left.index, scope);
          if (Array.isArray(arr)) {
            arr[idx] = rightVal;
          }
          return rightVal;
        }
        return rightVal;
      }

      case 'CallExpression': {
        const callee = expr.callee.name;
        const args = (expr.arguments || []).map(a => this.evalExpr(a, scope));

        if (callee === 'puts' || callee === 'print' || callee === 'printf') {
          if (callee === 'printf' && typeof args[0] === 'string' && /%[dsf]/.test(args[0])) {
            let regIdx = 1;
            const formatted = args[0].replace(/%[dsf]/g, () => {
              const v = args[regIdx] !== undefined ? args[regIdx] : '';
              regIdx++;
              return v;
            });
            this.outputBuffer.push(formatted);
          } else {
            for (const a of args) {
              this.outputBuffer.push(a !== undefined && a !== null ? a : '');
            }
          }
          return 0;
        }

        if (callee === 'gets') {
          return '0';
        }

        if (callee === 'to_i') {
          return parseInt(args[0], 10) || 0;
        }

        if (callee === 'to_f') {
          return parseFloat(args[0]) || 0;
        }

        const func = this.functions.get(callee);
        if (func) {
          return this.evalFunction(func, args);
        }
        return 0;
      }

      case 'ArrayAccess': {
        const arr = scope.get(expr.array.name);
        const idx = this.evalExpr(expr.index, scope);
        return Array.isArray(arr) ? (arr[idx] || 0) : 0;
      }

      case 'GroupingExpression':
        return this.evalExpr(expr.expression, scope);

      default:
        return 0;
    }
  }
}

// Export for browser and node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VirtualMachine, ASTInterpreter };
}

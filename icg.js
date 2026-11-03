/**
 * CompilerLens - MiniRuby Intermediate Code Generator (icg.js)
 * Phase 4: Generates Three-Address Code (TAC) quadruples grouped by subroutine,
 * handles MiniRuby constructs (assignments, exponentiation **, puts/print, if/elsif/else, while, def/end),
 * partitions TAC instructions into Basic Blocks via leader analysis,
 * and constructs the Control Flow Graph (CFG) with SVG coordinates.
 */

class TACInstruction {
  constructor({ op, arg1 = null, arg2 = null, result = null, label = null, line = null, comment = '' }) {
    this.op = op;             // e.g. '=', '+', '-', '*', '/', '%', '**', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '!', 'NEG', 'LABEL', 'GOTO', 'IF_GOTO', 'IF_FALSE_GOTO', 'PARAM', 'CALL', 'RETURN', 'ARRAY_LOAD', 'ARRAY_STORE'
    this.arg1 = arg1;
    this.arg2 = arg2;
    this.result = result;
    this.label = label;
    this.line = line;
    this.comment = comment;
  }

  toString() {
    switch (this.op) {
      case 'LABEL':
        return `${this.result}:`;
      case '=':
        return `${this.result} = ${this.arg1}`;
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
      case '**':
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=':
      case '&&':
      case '||':
        return `${this.result} = ${this.arg1} ${this.op} ${this.arg2}`;
      case '!':
      case 'NEG':
        return `${this.result} = ${this.op === 'NEG' ? '-' : '!'} ${this.arg1}`;
      case 'GOTO':
        return `goto ${this.result}`;
      case 'IF_GOTO':
        return `if ${this.arg1} goto ${this.result}`;
      case 'IF_FALSE_GOTO':
        return `ifFalse ${this.arg1} goto ${this.result}`;
      case 'PARAM':
        return `param ${this.arg1}`;
      case 'CALL':
        return this.result ? `${this.result} = call ${this.arg1}, ${this.arg2}` : `call ${this.arg1}, ${this.arg2}`;
      case 'RETURN':
        return this.arg1 ? `return ${this.arg1}` : `return`;
      case 'ARRAY_LOAD':
        return `${this.result} = ${this.arg1}[${this.arg2}]`;
      case 'ARRAY_STORE':
        return `${this.arg1}[${this.arg2}] = ${this.result}`;
      default:
        return `${this.op} ${this.arg1 || ''} ${this.arg2 || ''} ${this.result || ''}`.trim();
    }
  }
}

class BasicBlock {
  constructor(id, label = '') {
    this.id = id;               // e.g. "B0", "B1"
    this.label = label;         // e.g. "entry", "L1"
    this.instructions = [];
    this.predecessors = [];     // Array of block ids
    this.successors = [];       // Array of { targetId, type: 'unconditional'|'true'|'false'|'fallthrough' }
    // Visual layout coordinates
    this.x = 0;
    this.y = 0;
    this.width = 260;
    this.height = 100;
  }
}

class ICGGenerator {
  constructor() {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.globalBlockCounter = 0;
    this.instructions = [];
    this.functions = [];        // Grouped by function: { name, returnType, params, instructions, blocks }
    this.currentFunction = null;
    this.loopStack = [];        // For break and next: { continueLabel, breakLabel }
  }

  generate(ast) {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.globalBlockCounter = 0;
    this.instructions = [];
    this.functions = [];
    this.currentFunction = null;
    this.loopStack = [];

    if (!ast) return { instructions: [], functions: [], blocks: [] };

    // Separate user functions from top-level script statements
    const funcDecls = [];
    const topLevelStmts = [];

    for (const stmt of ast.declarations || []) {
      if (stmt.type === 'FunctionDeclaration') {
        funcDecls.push(stmt);
      } else {
        topLevelStmts.push(stmt);
      }
    }

    // 1. Generate helper user-defined functions
    for (const func of funcDecls) {
      this.generateFunction(func);
    }

    // 2. Synthesize main function for top-level MiniRuby script execution
    this.currentFunction = {
      name: 'main',
      returnType: 'any',
      params: [],
      instructions: [],
      blocks: []
    };
    this.functions.push(this.currentFunction);

    this.emit('LABEL', null, null, 'func_main', 1);

    for (const stmt of topLevelStmts) {
      this.generateStatement(stmt);
    }

    this.emit('RETURN', '0', null, null, 1);
    this.currentFunction = null;

    // 3. Partition basic blocks and build CFG for each function
    for (const func of this.functions) {
      func.blocks = this.buildBasicBlocks(func.instructions, func.name);
    }

    return {
      instructions: this.instructions,
      functions: this.functions
    };
  }

  newTemp() {
    return `t${this.tempCounter++}`;
  }

  newLabel(prefix = 'L') {
    return `${prefix}${this.labelCounter++}`;
  }

  emit(op, arg1 = null, arg2 = null, result = null, line = null, comment = '') {
    const inst = new TACInstruction({ op, arg1, arg2, result, line, comment });
    this.instructions.push(inst);
    if (this.currentFunction) {
      this.currentFunction.instructions.push(inst);
    }
    return inst;
  }

  // -------------------------------------------------------------
  // Function Generation
  // -------------------------------------------------------------

  generateFunction(funcNode) {
    const prevFunction = this.currentFunction;
    this.currentFunction = {
      name: funcNode.name,
      returnType: 'any',
      params: (funcNode.params || []).map(p => p.name),
      instructions: [],
      blocks: []
    };
    this.functions.push(this.currentFunction);

    this.emit('LABEL', null, null, `func_${funcNode.name}`, funcNode.line);

    if (funcNode.body && funcNode.body.statements) {
      for (const stmt of funcNode.body.statements) {
        this.generateStatement(stmt);
      }
    }

    // Ensure implicit return 0 / nil if function end was not an explicit return
    const lastInst = this.currentFunction.instructions[this.currentFunction.instructions.length - 1];
    if (!lastInst || lastInst.op !== 'RETURN') {
      this.emit('RETURN', '0', null, null, funcNode.endLine || funcNode.line);
    }

    this.currentFunction = prevFunction;
  }

  // -------------------------------------------------------------
  // Statement Generation
  // -------------------------------------------------------------

  generateStatement(stmt) {
    if (!stmt) return;

    switch (stmt.type) {
      case 'ExpressionStatement':
        if (stmt.expression) {
          this.generateExpression(stmt.expression);
        }
        break;

      case 'IfStatement': {
        const falseLabel = this.newLabel('L_else_');
        const endLabel = this.newLabel('L_endif_');

        // Condition
        const condVal = this.generateExpression(stmt.condition);
        this.emit('IF_FALSE_GOTO', condVal, null, falseLabel, stmt.line);

        // Then Branch
        if (stmt.thenBranch && stmt.thenBranch.statements) {
          for (const s of stmt.thenBranch.statements) {
            this.generateStatement(s);
          }
        }

        // Jump over else
        const hasElsif = stmt.elsifBranches && stmt.elsifBranches.length > 0;
        const hasElse = stmt.elseBranch && stmt.elseBranch.statements && stmt.elseBranch.statements.length > 0;

        if (hasElsif || hasElse) {
          this.emit('GOTO', null, null, endLabel, stmt.line);
        }

        this.emit('LABEL', null, null, falseLabel, stmt.line);

        // Elsif branches
        let currentNextLabel = falseLabel;
        for (let i = 0; i < (stmt.elsifBranches || []).length; i++) {
          const elsifBranch = stmt.elsifBranches[i];
          const nextElsifLabel = this.newLabel('L_elsif_');

          const elsifCond = this.generateExpression(elsifBranch.condition);
          this.emit('IF_FALSE_GOTO', elsifCond, null, nextElsifLabel, elsifBranch.condition.line);

          if (elsifBranch.body && elsifBranch.body.statements) {
            for (const s of elsifBranch.body.statements) {
              this.generateStatement(s);
            }
          }
          this.emit('GOTO', null, null, endLabel, elsifBranch.condition.line);
          this.emit('LABEL', null, null, nextElsifLabel, elsifBranch.condition.line);
        }

        // Else Branch
        if (hasElse) {
          for (const s of stmt.elseBranch.statements) {
            this.generateStatement(s);
          }
        }

        if (hasElsif || hasElse) {
          this.emit('LABEL', null, null, endLabel, stmt.line);
        }
        break;
      }

      case 'WhileStatement': {
        const startLabel = this.newLabel('L_while_start_');
        const endLabel = this.newLabel('L_while_end_');

        this.loopStack.push({ continueLabel: startLabel, breakLabel: endLabel });

        this.emit('LABEL', null, null, startLabel, stmt.line);
        const condVal = this.generateExpression(stmt.condition);
        this.emit('IF_FALSE_GOTO', condVal, null, endLabel, stmt.line);

        if (stmt.body && stmt.body.statements) {
          for (const s of stmt.body.statements) {
            this.generateStatement(s);
          }
        }

        this.emit('GOTO', null, null, startLabel, stmt.line);
        this.emit('LABEL', null, null, endLabel, stmt.line);

        this.loopStack.pop();
        break;
      }

      case 'ReturnStatement': {
        const val = stmt.argument ? this.generateExpression(stmt.argument) : '0';
        this.emit('RETURN', val, null, null, stmt.line);
        break;
      }

      case 'BreakStatement': {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (loop) {
          this.emit('GOTO', null, null, loop.breakLabel, stmt.line);
        }
        break;
      }

      case 'ContinueStatement': {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (loop) {
          this.emit('GOTO', null, null, loop.continueLabel, stmt.line);
        }
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------
  // Expression Generation
  // -------------------------------------------------------------

  generateExpression(expr) {
    if (!expr) return '0';

    switch (expr.type) {
      case 'Literal': {
        if (expr.dataType === 'string') {
          return `"${expr.value}"`;
        }
        if (expr.dataType === 'nil') {
          return '0';
        }
        if (expr.dataType === 'bool') {
          return expr.value ? '1' : '0';
        }
        return String(expr.value);
      }

      case 'Identifier':
        return expr.name;

      case 'BinaryExpression': {
        const left = this.generateExpression(expr.left);
        const right = this.generateExpression(expr.right);
        const temp = this.newTemp();
        this.emit(expr.operator, left, right, temp, expr.line);
        return temp;
      }

      case 'LogicalExpression': {
        const left = this.generateExpression(expr.left);
        const right = this.generateExpression(expr.right);
        const temp = this.newTemp();
        this.emit(expr.operator, left, right, temp, expr.line);
        return temp;
      }

      case 'UnaryExpression': {
        const arg = this.generateExpression(expr.argument);
        const temp = this.newTemp();
        const op = expr.operator === '-' ? 'NEG' : '!';
        this.emit(op, arg, null, temp, expr.line);
        return temp;
      }

      case 'AssignmentExpression': {
        const rightVal = this.generateExpression(expr.right);

        if (expr.operator === '=') {
          if (expr.left.type === 'Identifier') {
            this.emit('=', rightVal, null, expr.left.name, expr.line);
            return expr.left.name;
          } else if (expr.left.type === 'ArrayAccess') {
            const idxVal = this.generateExpression(expr.left.index);
            this.emit('ARRAY_STORE', expr.left.array.name, idxVal, rightVal, expr.line);
            return rightVal;
          }
        } else {
          // Compound assignment: +=, -=, *=, /=, %=, **=
          const binOp = expr.operator.slice(0, -1);
          const target = expr.left.name;
          const temp = this.newTemp();
          this.emit(binOp, target, rightVal, temp, expr.line);
          this.emit('=', temp, null, target, expr.line);
          return target;
        }
        return rightVal;
      }

      case 'CallExpression': {
        const callee = expr.callee.name;
        const argValues = (expr.arguments || []).map(arg => this.generateExpression(arg));

        // Push arguments
        for (const argVal of argValues) {
          this.emit('PARAM', argVal, null, null, expr.line);
        }

        // I/O commands or standard function call
        if (callee === 'puts' || callee === 'print') {
          this.emit('CALL', callee, argValues.length, null, expr.line);
          return '0';
        }

        const retTemp = this.newTemp();
        this.emit('CALL', callee, argValues.length, retTemp, expr.line);
        return retTemp;
      }

      case 'ArrayAccess': {
        const idxVal = this.generateExpression(expr.index);
        const temp = this.newTemp();
        this.emit('ARRAY_LOAD', expr.array.name, idxVal, temp, expr.line);
        return temp;
      }

      case 'GroupingExpression':
        return this.generateExpression(expr.expression);

      default:
        return '0';
    }
  }

  // -------------------------------------------------------------
  // Basic Block Partitioning & CFG
  // -------------------------------------------------------------

  buildBasicBlocks(instructions, funcName = 'main') {
    if (!instructions || instructions.length === 0) return [];

    // Step 1: Identify leaders
    const isLeader = new Array(instructions.length).fill(false);
    isLeader[0] = true;

    for (let i = 0; i < instructions.length; i++) {
      const inst = instructions[i];

      if (inst.op === 'LABEL') {
        isLeader[i] = true;
      }

      if (inst.op === 'GOTO' || inst.op === 'IF_GOTO' || inst.op === 'IF_FALSE_GOTO' || inst.op === 'RETURN') {
        if (i + 1 < instructions.length) {
          isLeader[i + 1] = true;
        }
      }
    }

    // Step 2: Form Basic Blocks from leaders
    const blocks = [];
    let currentBlock = null;

    for (let i = 0; i < instructions.length; i++) {
      if (isLeader[i]) {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        const blockName = `B${this.globalBlockCounter++}`;
        currentBlock = new BasicBlock(blockName);
        if (instructions[i].op === 'LABEL') {
          currentBlock.label = instructions[i].result;
        }
      }
      currentBlock.instructions.push(instructions[i]);
    }
    if (currentBlock) {
      blocks.push(currentBlock);
    }

    // Step 3: Map labels to block IDs
    const labelToBlock = new Map();
    for (const b of blocks) {
      for (const inst of b.instructions) {
        if (inst.op === 'LABEL') {
          labelToBlock.set(inst.result, b.id);
        }
      }
    }

    // Step 4: Add CFG edges
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const last = b.instructions[b.instructions.length - 1];
      if (!last) continue;

      if (last.op === 'GOTO') {
        const targetBlock = labelToBlock.get(last.result);
        if (targetBlock) {
          b.successors.push({ targetId: targetBlock, type: 'unconditional' });
        }
      } else if (last.op === 'IF_GOTO') {
        const targetBlock = labelToBlock.get(last.result);
        if (targetBlock) {
          b.successors.push({ targetId: targetBlock, type: 'true' });
        }
        if (i + 1 < blocks.length) {
          b.successors.push({ targetId: blocks[i + 1].id, type: 'false' });
        }
      } else if (last.op === 'IF_FALSE_GOTO') {
        const targetBlock = labelToBlock.get(last.result);
        if (targetBlock) {
          b.successors.push({ targetId: targetBlock, type: 'false' });
        }
        if (i + 1 < blocks.length) {
          b.successors.push({ targetId: blocks[i + 1].id, type: 'true' });
        }
      } else if (last.op === 'RETURN') {
        // Function exit, no successors
      } else {
        if (i + 1 < blocks.length) {
          b.successors.push({ targetId: blocks[i + 1].id, type: 'fallthrough' });
        }
      }
    }

    // Step 5: Compute predecessors
    for (const b of blocks) {
      for (const succ of b.successors) {
        const target = blocks.find(blk => blk.id === succ.targetId);
        if (target && !target.predecessors.includes(b.id)) {
          target.predecessors.push(b.id);
        }
      }
    }

    return blocks;
  }
}

// Export for Node.js test suites
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ICGGenerator, TACInstruction, BasicBlock };
}

/**
 * CompilerLens - Intermediate Code Generator (icg.js)
 * Phase 4: Generates Three-Address Code (TAC) quadruples grouped by function,
 * partitions instructions into Basic Blocks, and builds the Control Flow Graph (CFG)
 * with coordinates for interactive SVG rendering.
 */

class TACInstruction {
  constructor({ op, arg1 = null, arg2 = null, result = null, label = null, line = null, comment = '' }) {
    this.op = op;             // e.g. '=', '+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '!', 'LABEL', 'GOTO', 'IF_GOTO', 'IF_FALSE_GOTO', 'PARAM', 'CALL', 'RETURN', 'ARRAY_LOAD', 'ARRAY_STORE'
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
    // Visual layout properties
    this.x = 0;
    this.y = 0;
    this.width = 240;
    this.height = 100;
  }
}

class ICGGenerator {
  constructor() {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.instructions = [];
    this.functions = [];        // Grouped by function: { name, returnType, params, instructions, blocks }
    this.currentFunction = null;
    this.loopStack = [];        // For break and continue: { continueLabel, breakLabel }
  }

  generate(ast) {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.instructions = [];
    this.functions = [];
    this.currentFunction = null;
    this.loopStack = [];

    if (!ast) return { instructions: [], functions: [], blocks: [] };

    // Process top-level declarations
    for (const decl of ast.declarations || []) {
      if (decl.type === 'FunctionDeclaration') {
        this.generateFunction(decl);
      } else if (decl.type === 'VariableDeclaration') {
        this.generateGlobalVariables(decl);
      } else if (decl.type === 'ArrayDeclaration') {
        this.generateGlobalArray(decl);
      }
    }

    // Partition basic blocks for each function
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

  emitLabel(labelName, line = null) {
    return this.emit('LABEL', null, null, labelName, line);
  }

  // -------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------

  generateFunction(node) {
    const funcData = {
      name: node.name,
      returnType: node.returnType,
      params: (node.params || []).map(p => p.name),
      instructions: [],
      blocks: []
    };
    this.functions.push(funcData);
    this.currentFunction = funcData;

    // Function Entry Label
    this.emitLabel(`func_${node.name}`, node.line);

    // Generate Body
    if (node.body) {
      this.generateBlock(node.body);
    }

    // Ensure terminal return exists
    const lastInst = funcData.instructions[funcData.instructions.length - 1];
    if (!lastInst || lastInst.op !== 'RETURN') {
      this.emit('RETURN', null, null, null, node.endLine || node.line, 'implicit void return');
    }

    this.currentFunction = null;
  }

  generateGlobalVariables(node) {
    for (const decl of node.declarations || []) {
      if (decl.init) {
        const val = this.generateExpression(decl.init);
        this.emit('=', val, null, decl.id.name, decl.line, `global init ${decl.id.name}`);
      }
    }
  }

  generateGlobalArray(node) {
    // Array declaration note in TAC
    if (node.elements && node.elements.length > 0) {
      node.elements.forEach((el, idx) => {
        const val = this.generateExpression(el);
        this.emit('ARRAY_STORE', node.name, idx, val, el.line);
      });
    }
  }

  // -------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------

  generateBlock(blockNode) {
    for (const stmt of blockNode.statements || []) {
      this.generateStatement(stmt);
    }
  }

  generateStatement(stmt) {
    if (!stmt) return;

    switch (stmt.type) {
      case 'BlockStatement':
        this.generateBlock(stmt);
        break;

      case 'VariableDeclaration':
        for (const decl of stmt.declarations || []) {
          if (decl.init) {
            const val = this.generateExpression(decl.init);
            this.emit('=', val, null, decl.id.name, decl.line);
          }
        }
        break;

      case 'ArrayDeclaration':
        if (stmt.elements && stmt.elements.length > 0) {
          stmt.elements.forEach((el, idx) => {
            const val = this.generateExpression(el);
            this.emit('ARRAY_STORE', stmt.name, idx, val, el.line);
          });
        }
        break;

      case 'ExpressionStatement':
        if (stmt.expression) {
          this.generateExpression(stmt.expression);
        }
        break;

      case 'IfStatement': {
        const cond = this.generateExpression(stmt.condition);
        const trueLabel = this.newLabel('L_then');
        const falseLabel = this.newLabel('L_else');
        const endLabel = this.newLabel('L_ifend');

        if (stmt.elseBranch) {
          this.emit('IF_GOTO', cond, null, trueLabel, stmt.line);
          this.emit('GOTO', null, null, falseLabel, stmt.line);

          this.emitLabel(trueLabel, stmt.thenBranch.line);
          this.generateStatement(stmt.thenBranch);
          this.emit('GOTO', null, null, endLabel);

          this.emitLabel(falseLabel, stmt.elseBranch.line);
          this.generateStatement(stmt.elseBranch);

          this.emitLabel(endLabel);
        } else {
          this.emit('IF_FALSE_GOTO', cond, null, endLabel, stmt.line);
          this.generateStatement(stmt.thenBranch);
          this.emitLabel(endLabel);
        }
        break;
      }

      case 'WhileStatement': {
        const startLabel = this.newLabel('L_while_cond');
        const bodyLabel = this.newLabel('L_while_body');
        const endLabel = this.newLabel('L_while_end');

        this.loopStack.push({ continueLabel: startLabel, breakLabel: endLabel });

        this.emitLabel(startLabel, stmt.line);
        const cond = this.generateExpression(stmt.condition);
        this.emit('IF_FALSE_GOTO', cond, null, endLabel, stmt.line);

        this.generateStatement(stmt.body);
        this.emit('GOTO', null, null, startLabel);

        this.emitLabel(endLabel);
        this.loopStack.pop();
        break;
      }

      case 'DoWhileStatement': {
        const bodyLabel = this.newLabel('L_do_body');
        const condLabel = this.newLabel('L_do_cond');
        const endLabel = this.newLabel('L_do_end');

        this.loopStack.push({ continueLabel: condLabel, breakLabel: endLabel });

        this.emitLabel(bodyLabel, stmt.line);
        this.generateStatement(stmt.body);

        this.emitLabel(condLabel);
        const cond = this.generateExpression(stmt.condition);
        this.emit('IF_GOTO', cond, null, bodyLabel, stmt.line);

        this.emitLabel(endLabel);
        this.loopStack.pop();
        break;
      }

      case 'ForStatement': {
        const condLabel = this.newLabel('L_for_cond');
        const stepLabel = this.newLabel('L_for_step');
        const bodyLabel = this.newLabel('L_for_body');
        const endLabel = this.newLabel('L_for_end');

        this.loopStack.push({ continueLabel: stepLabel, breakLabel: endLabel });

        // Init
        if (stmt.init) {
          if (stmt.init.type === 'VariableDeclaration') {
            this.generateStatement(stmt.init);
          } else {
            this.generateExpression(stmt.init);
          }
        }

        this.emitLabel(condLabel, stmt.line);
        if (stmt.condition) {
          const cond = this.generateExpression(stmt.condition);
          this.emit('IF_FALSE_GOTO', cond, null, endLabel, stmt.line);
        }

        // Body
        this.generateStatement(stmt.body);

        // Step
        this.emitLabel(stepLabel);
        if (stmt.step) {
          this.generateExpression(stmt.step);
        }
        this.emit('GOTO', null, null, condLabel);

        this.emitLabel(endLabel);
        this.loopStack.pop();
        break;
      }

      case 'ReturnStatement': {
        if (stmt.argument) {
          const val = this.generateExpression(stmt.argument);
          this.emit('RETURN', val, null, null, stmt.line);
        } else {
          this.emit('RETURN', null, null, null, stmt.line);
        }
        break;
      }

      case 'BreakStatement': {
        if (this.loopStack.length > 0) {
          const loop = this.loopStack[this.loopStack.length - 1];
          this.emit('GOTO', null, null, loop.breakLabel, stmt.line);
        }
        break;
      }

      case 'ContinueStatement': {
        if (this.loopStack.length > 0) {
          const loop = this.loopStack[this.loopStack.length - 1];
          this.emit('GOTO', null, null, loop.continueLabel, stmt.line);
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------

  generateExpression(expr) {
    if (!expr) return null;

    switch (expr.type) {
      case 'Literal':
        return expr.raw !== undefined ? expr.raw : expr.value;

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
        const op = expr.operator === '-' ? 'NEG' : expr.operator;
        this.emit(op, arg, null, temp, expr.line);
        return temp;
      }

      case 'UpdateExpression': {
        const isPrefix = expr.prefix;
        const op = expr.operator === '++' ? '+' : '-';
        const target = expr.argument.name;

        if (isPrefix) {
          this.emit(op, target, '1', target, expr.line);
          return target;
        } else {
          const temp = this.newTemp();
          this.emit('=', target, null, temp, expr.line);
          this.emit(op, target, '1', target, expr.line);
          return temp;
        }
      }

      case 'AssignmentExpression': {
        const rightVal = this.generateExpression(expr.right);
        const op = expr.operator;

        if (expr.left.type === 'Identifier') {
          const varName = expr.left.name;
          if (op === '=') {
            this.emit('=', rightVal, null, varName, expr.line);
          } else {
            // Compound assignment: +=, -=, *=, /=, %=
            const baseOp = op.slice(0, -1);
            const temp = this.newTemp();
            this.emit(baseOp, varName, rightVal, temp, expr.line);
            this.emit('=', temp, null, varName, expr.line);
          }
          return varName;
        } else if (expr.left.type === 'ArrayAccess') {
          const arrName = expr.left.array.name;
          const idxVal = this.generateExpression(expr.left.index);
          if (op === '=') {
            this.emit('ARRAY_STORE', arrName, idxVal, rightVal, expr.line);
          } else {
            const baseOp = op.slice(0, -1);
            const currentVal = this.newTemp();
            this.emit('ARRAY_LOAD', arrName, idxVal, currentVal, expr.line);
            const newVal = this.newTemp();
            this.emit(baseOp, currentVal, rightVal, newVal, expr.line);
            this.emit('ARRAY_STORE', arrName, idxVal, newVal, expr.line);
          }
          return rightVal;
        }
        return rightVal;
      }

      case 'CallExpression': {
        const callee = expr.callee.name;
        const argValues = (expr.arguments || []).map(arg => this.generateExpression(arg));

        for (const argVal of argValues) {
          this.emit('PARAM', argVal, null, null, expr.line);
        }

        // Void built-ins or expression calls
        if (callee === 'print' || callee === 'printf') {
          this.emit('CALL', callee, argValues.length, null, expr.line);
          return null;
        }

        const retTemp = this.newTemp();
        this.emit('CALL', callee, argValues.length, retTemp, expr.line);
        return retTemp;
      }

      case 'ArrayAccess': {
        const arrName = expr.array.name;
        const idxVal = this.generateExpression(expr.index);
        const temp = this.newTemp();
        this.emit('ARRAY_LOAD', arrName, idxVal, temp, expr.line);
        return temp;
      }

      case 'GroupingExpression':
        return this.generateExpression(expr.expression);

      default:
        return null;
    }
  }

  // -------------------------------------------------------------
  // Basic Block Partitioning & Control Flow Graph
  // -------------------------------------------------------------

  buildBasicBlocks(instructions, funcName = 'main') {
    if (!instructions || instructions.length === 0) return [];

    // Step 1: Identify leaders
    const isLeader = new Array(instructions.length).fill(false);
    isLeader[0] = true; // First instruction is leader

    for (let i = 0; i < instructions.length; i++) {
      const inst = instructions[i];

      // Targets of jumps are leaders
      if (inst.op === 'LABEL') {
        isLeader[i] = true;
      }

      // Instruction following a jump or return is a leader
      if (inst.op === 'GOTO' || inst.op === 'IF_GOTO' || inst.op === 'IF_FALSE_GOTO' || inst.op === 'RETURN') {
        if (i + 1 < instructions.length) {
          isLeader[i + 1] = true;
        }
      }
    }

    // Step 2: Form Basic Blocks from leaders
    const blocks = [];
    let currentBlock = null;
    let blockIdCounter = 0;

    for (let i = 0; i < instructions.length; i++) {
      if (isLeader[i]) {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        const blockName = `B${blockIdCounter++}`;
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
        // Fall-through false branch
        if (i + 1 < blocks.length) {
          b.successors.push({ targetId: blocks[i + 1].id, type: 'false' });
        }
      } else if (last.op === 'IF_FALSE_GOTO') {
        const targetBlock = labelToBlock.get(last.result);
        if (targetBlock) {
          b.successors.push({ targetId: targetBlock, type: 'false' });
        }
        // Fall-through true branch
        if (i + 1 < blocks.length) {
          b.successors.push({ targetId: blocks[i + 1].id, type: 'true' });
        }
      } else if (last.op === 'RETURN') {
        // Function exit, no successor
      } else {
        // Fall-through
        if (i + 1 < blocks.length) {
          b.successors.push({ targetId: blocks[i + 1].id, type: 'fallthrough' });
        }
      }
    }

    // Compute predecessor lists
    for (const b of blocks) {
      for (const succ of b.successors) {
        const target = blocks.find(blk => blk.id === succ.targetId);
        if (target && !target.predecessors.includes(b.id)) {
          target.predecessors.push(b.id);
        }
      }
    }

    // Step 5: Compute CFG visual layout coordinates
    ICGGenerator.computeCFGLayout(blocks);

    return blocks;
  }

  // -------------------------------------------------------------
  // CFG Diagram SVG Layout
  // -------------------------------------------------------------

  static computeCFGLayout(blocks) {
    if (!blocks || blocks.length === 0) return { width: 400, height: 300 };

    const blockWidth = 260;
    const verticalGap = 70;
    const horizontalGap = 80;

    let currentY = 50;

    // Simple top-to-bottom layout with branches branching slightly right
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const instCount = b.instructions.length;
      b.width = blockWidth;
      b.height = Math.max(70, instCount * 22 + 45);

      // Check if this block is an 'else' or side branch
      const hasBackEdge = b.successors.some(s => {
        const targetIdx = blocks.findIndex(blk => blk.id === s.targetId);
        return targetIdx <= i;
      });

      b.x = 80;
      b.y = currentY;
      currentY += b.height + verticalGap;
    }

    return {
      width: blockWidth + 240,
      height: currentY + 50
    };
  }
}

// Export for browser and node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ICGGenerator, TACInstruction, BasicBlock };
}


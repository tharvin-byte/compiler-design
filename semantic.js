/**
 * CompilerLens - MiniRuby Semantic Analyzer (semantic.js)
 * Phase 3: Dynamic Symbol Table management across scopes (Global, Function),
 * dynamic type inference and tracking, undefined variable detection,
 * type compatibility validation for operations (+, -, *, /, %, **),
 * function parameter and call argument checking, and compiler diagnostics & quick fixes.
 */

class SymbolInfo {
  constructor({ name, type = 'any', kind = 'variable', scopeLevel = 0, scopeName = 'Global', line = 0, col = 0, size = null, params = [], returnType = 'any', isBuiltin = false }) {
    this.name = name;
    this.type = type;             // 'int' | 'float' | 'string' | 'bool' | 'nil' | 'any'
    this.kind = kind;             // 'variable' | 'parameter' | 'function'
    this.scopeLevel = scopeLevel;
    this.scopeName = scopeName;
    this.line = line;
    this.col = col;
    this.size = size;
    this.params = params;
    this.returnType = returnType;
    this.isBuiltin = isBuiltin;
    this.initialized = true;
    this.used = false;
  }
}

class Scope {
  constructor(name, level = 0, parent = null) {
    this.name = name;
    this.level = level;
    this.parent = parent;
    this.symbols = new Map();
    this.children = [];
  }

  define(name, symbolInfo) {
    this.symbols.set(name, symbolInfo);
  }

  resolve(name) {
    if (this.symbols.has(name)) {
      return this.symbols.get(name);
    }
    if (this.parent) {
      return this.parent.resolve(name);
    }
    return null;
  }

  hasLocal(name) {
    return this.symbols.has(name);
  }
}

class SemanticAnalyzer {
  constructor() {
    this.globalScope = new Scope('Global', 0, null);
    this.currentScope = this.globalScope;
    this.allScopes = [this.globalScope];
    this.errors = [];
    this.warnings = [];
    this.passedChecks = [];
    this.quickFixes = [];
    this.currentFunction = null;
    this.sourceCode = '';

    this.registerBuiltins();
  }

  registerBuiltins() {
    const builtins = [
      { name: 'puts', type: 'nil', kind: 'function', params: [{ name: 'val', type: 'any' }], returnType: 'nil' },
      { name: 'print', type: 'nil', kind: 'function', params: [{ name: 'val', type: 'any' }], returnType: 'nil' },
      { name: 'gets', type: 'string', kind: 'function', params: [], returnType: 'string' },
      { name: 'input', type: 'int', kind: 'function', params: [], returnType: 'int' },
      { name: 'to_i', type: 'int', kind: 'function', params: [{ name: 'val', type: 'any' }], returnType: 'int' },
      { name: 'to_f', type: 'float', kind: 'function', params: [{ name: 'val', type: 'any' }], returnType: 'float' },
      { name: 'to_s', type: 'string', kind: 'function', params: [{ name: 'val', type: 'any' }], returnType: 'string' }
    ];

    for (const b of builtins) {
      this.globalScope.define(b.name, new SymbolInfo({
        name: b.name,
        type: b.type,
        kind: b.kind,
        scopeLevel: 0,
        scopeName: 'Global (Built-in)',
        line: 0,
        col: 0,
        params: b.params,
        returnType: b.returnType,
        isBuiltin: true
      }));
    }
  }

  analyze(ast, sourceCode = '') {
    this.sourceCode = sourceCode;
    this.globalScope = new Scope('Global', 0, null);
    this.currentScope = this.globalScope;
    this.allScopes = [this.globalScope];
    this.errors = [];
    this.warnings = [];
    this.passedChecks = [];
    this.quickFixes = [];
    this.currentFunction = null;

    this.registerBuiltins();

    if (!ast) {
      return this.getResult();
    }

    // Pass 1: Register function declarations for forward referencing
    for (const stmt of ast.declarations || []) {
      if (stmt.type === 'FunctionDeclaration') {
        this.declareFunction(stmt);
      }
    }

    // Pass 2: Analyze top-level statements and function bodies
    for (const stmt of ast.declarations || []) {
      if (stmt.type === 'FunctionDeclaration') {
        this.analyzeFunction(stmt);
      } else {
        this.analyzeStatement(stmt);
      }
    }

    // Final checks & diagnostics
    if (this.errors.length === 0) {
      this.passedChecks.push({
        name: 'Identifier Resolution',
        message: 'All variable and function references resolved successfully in their scopes.'
      });
      this.passedChecks.push({
        name: 'Dynamic Type Safety',
        message: 'All operations, assignments, and calls conform to MiniRuby dynamic typing rules.'
      });
    }

    return this.getResult();
  }

  getResult() {
    return {
      errors: this.errors,
      warnings: this.warnings,
      passedChecks: this.passedChecks,
      quickFixes: this.quickFixes,
      symbolTables: this.getFlattenedSymbolTable(),
      allScopes: this.allScopes
    };
  }

  getFlattenedSymbolTable() {
    const list = [];
    for (const scope of this.allScopes) {
      for (const [name, sym] of scope.symbols.entries()) {
        list.push({
          name: sym.name,
          type: sym.type,
          kind: sym.kind,
          scopeLevel: sym.scopeLevel,
          scopeName: sym.scopeName,
          line: sym.line === 0 ? 'built-in' : sym.line,
          col: sym.col === 0 ? '-' : sym.col,
          size: sym.size,
          returnType: sym.returnType,
          isBuiltin: sym.isBuiltin
        });
      }
    }
    return list;
  }

  // -------------------------------------------------------------
  // Function Analysis
  // -------------------------------------------------------------

  declareFunction(node) {
    if (this.globalScope.hasLocal(node.name)) {
      this.addError(node, `Redefinition of function '${node.name}' in the same scope.`, `Use a distinct name for the function.`);
      return;
    }

    const sym = new SymbolInfo({
      name: node.name,
      type: 'function',
      kind: 'function',
      scopeLevel: 0,
      scopeName: 'Global',
      line: node.line,
      col: node.col,
      params: (node.params || []).map(p => ({ name: p.name, type: 'any' })),
      returnType: 'any',
      isBuiltin: false
    });

    this.globalScope.define(node.name, sym);
  }

  analyzeFunction(node) {
    const prevFunction = this.currentFunction;
    const prevScope = this.currentScope;

    this.currentFunction = node;
    const funcScope = new Scope(`Function: ${node.name}`, prevScope.level + 1, prevScope);
    this.currentScope = funcScope;
    this.allScopes.push(funcScope);

    // Define parameters in function scope
    for (const param of node.params || []) {
      const pSym = new SymbolInfo({
        name: param.name,
        type: 'any',
        kind: 'parameter',
        scopeLevel: funcScope.level,
        scopeName: funcScope.name,
        line: param.line,
        col: param.col,
        isBuiltin: false
      });
      funcScope.define(param.name, pSym);
    }

    // Analyze body
    if (node.body && node.body.statements) {
      for (const stmt of node.body.statements) {
        this.analyzeStatement(stmt);
      }
    }

    this.currentScope = prevScope;
    this.currentFunction = prevFunction;
  }

  // -------------------------------------------------------------
  // Statement Analysis
  // -------------------------------------------------------------

  analyzeStatement(stmt) {
    if (!stmt) return;

    switch (stmt.type) {
      case 'ExpressionStatement':
        if (stmt.expression) {
          this.analyzeExpression(stmt.expression);
        }
        break;

      case 'IfStatement': {
        this.analyzeExpression(stmt.condition);
        if (stmt.thenBranch && stmt.thenBranch.statements) {
          for (const s of stmt.thenBranch.statements) this.analyzeStatement(s);
        }
        for (const b of stmt.elsifBranches || []) {
          this.analyzeExpression(b.condition);
          if (b.body && b.body.statements) {
            for (const s of b.body.statements) this.analyzeStatement(s);
          }
        }
        if (stmt.elseBranch && stmt.elseBranch.statements) {
          for (const s of stmt.elseBranch.statements) this.analyzeStatement(s);
        }
        break;
      }

      case 'WhileStatement': {
        this.analyzeExpression(stmt.condition);
        if (stmt.body && stmt.body.statements) {
          for (const s of stmt.body.statements) this.analyzeStatement(s);
        }
        break;
      }

      case 'ReturnStatement': {
        if (stmt.argument) {
          this.analyzeExpression(stmt.argument);
        }
        break;
      }

      case 'BreakStatement':
      case 'ContinueStatement':
        // Valid inside loops
        break;

      default:
        break;
    }
  }

  // -------------------------------------------------------------
  // Expression Analysis & Dynamic Type Inference
  // -------------------------------------------------------------

  analyzeExpression(expr) {
    if (!expr) return 'any';

    switch (expr.type) {
      case 'Literal':
        return expr.dataType || 'any';

      case 'Identifier': {
        const sym = this.currentScope.resolve(expr.name);
        if (!sym) {
          this.addError(
            expr,
            `Undefined local variable or method '${expr.name}'.`,
            `Assign a value to '${expr.name}' before referencing it.`
          );
          this.quickFixes.push({
            title: `Initialize '${expr.name}'`,
            description: `Insert '${expr.name} = 0' before this usage.`,
            action: 'insert_code',
            code: `${expr.name} = 0\n`,
            line: expr.line
          });
          return 'any';
        }
        sym.used = true;
        return sym.type;
      }

      case 'AssignmentExpression': {
        const valueType = this.analyzeExpression(expr.right);

        // Variable assignment: define or update symbol dynamically in current scope!
        if (expr.left.type === 'Identifier') {
          const varName = expr.left.name;
          const existing = this.currentScope.resolve(varName);

          if (existing) {
            existing.type = valueType;
            existing.initialized = true;
          } else {
            // New dynamic variable definition
            const newSym = new SymbolInfo({
              name: varName,
              type: valueType,
              kind: 'variable',
              scopeLevel: this.currentScope.level,
              scopeName: this.currentScope.name,
              line: expr.left.line,
              col: expr.left.col,
              isBuiltin: false
            });
            this.currentScope.define(varName, newSym);
          }
        }
        return valueType;
      }

      case 'BinaryExpression': {
        const leftType = this.analyzeExpression(expr.left);
        const rightType = this.analyzeExpression(expr.right);
        const op = expr.operator;

        // Equality & Relational
        if (['==', '!=', '<', '<=', '>', '>='].includes(op)) {
          return 'bool';
        }

        // Exponentiation **
        if (op === '**') {
          if (leftType === 'string' || rightType === 'string') {
            this.addError(expr, `TypeError: undefined method '**' for string`);
            return 'any';
          }
          return (leftType === 'float' || rightType === 'float') ? 'float' : 'int';
        }

        // Arithmetic: +, -, *, /, %
        if (op === '+') {
          // String concatenation
          if (leftType === 'string' && rightType === 'string') {
            return 'string';
          }
          if (leftType === 'string' && (rightType === 'int' || rightType === 'float')) {
            this.addError(expr, `TypeError: no implicit conversion of ${rightType} into String for '+'`);
            return 'string';
          }
          if ((leftType === 'int' || leftType === 'float') && rightType === 'string') {
            this.addError(expr, `TypeError: String can't be coerced into ${leftType} for '+'`);
            return 'any';
          }
          return (leftType === 'float' || rightType === 'float') ? 'float' : 'int';
        }

        if (op === '*') {
          if (leftType === 'string' && rightType === 'int') {
            return 'string'; // String repetition: "abc" * 3
          }
          if (leftType === 'string' || rightType === 'string') {
            this.addError(expr, `TypeError: String cannot be multiplied by ${rightType}`);
            return 'any';
          }
          return (leftType === 'float' || rightType === 'float') ? 'float' : 'int';
        }

        if (['-', '/', '%'].includes(op)) {
          if (leftType === 'string' || rightType === 'string') {
            this.addError(expr, `TypeError: undefined method '${op}' for String`);
            return 'any';
          }
          return (leftType === 'float' || rightType === 'float') ? 'float' : 'int';
        }

        return 'any';
      }

      case 'LogicalExpression': {
        this.analyzeExpression(expr.left);
        this.analyzeExpression(expr.right);
        return 'bool';
      }

      case 'UnaryExpression': {
        const argType = this.analyzeExpression(expr.argument);
        if (expr.operator === '!') return 'bool';
        return argType;
      }

      case 'CallExpression': {
        const calleeName = expr.callee.name;
        const sym = this.currentScope.resolve(calleeName);

        if (!sym) {
          this.addError(
            expr,
            `Undefined method or function '${calleeName}' called.`,
            `Define 'def ${calleeName}' before calling it.`
          );
          return 'any';
        }

        // Analyze each argument
        for (const arg of expr.arguments || []) {
          this.analyzeExpression(arg);
        }

        // Parameter count check for user-defined functions
        if (!sym.isBuiltin && sym.params) {
          const expected = sym.params.length;
          const actual = (expr.arguments || []).length;
          if (expected !== actual) {
            this.addError(
              expr,
              `Wrong number of arguments for '${calleeName}' (given ${actual}, expected ${expected}).`
            );
          }
        }

        return sym.returnType || 'any';
      }

      case 'GroupingExpression':
        return this.analyzeExpression(expr.expression);

      case 'ArrayLiteral': {
        for (const elem of expr.elements || []) {
          this.analyzeExpression(elem);
        }
        return 'array';
      }

      case 'ArrayAccess': {
        this.analyzeExpression(expr.array);
        this.analyzeExpression(expr.index);
        return 'any';
      }

      default:
        return 'any';
    }
  }

  addError(node, message, suggestion = '') {
    this.errors.push({
      line: node.line || 1,
      col: node.col || 1,
      message,
      suggestion
    });
  }
}

// Export for Node.js test suites
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SemanticAnalyzer, Scope, SymbolInfo };
}

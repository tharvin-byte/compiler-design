/**
 * CompilerLens - Semantic Analyzer (semantic.js)
 * Phase 3: Symbol Table management across nested scopes (Global, Function, Block),
 * type checking, declaration validation, function signature checking, missing return checks,
 * implicit type promotion, and quick-fix recommendations.
 */

class SymbolInfo {
  constructor({ name, type, kind, scopeLevel, scopeName, line, col, size = null, params = [], returnType = null }) {
    this.name = name;
    this.type = type;
    this.kind = kind; // 'variable' | 'parameter' | 'function' | 'array'
    this.scopeLevel = scopeLevel;
    this.scopeName = scopeName;
    this.line = line;
    this.col = col;
    this.size = size;
    this.params = params;
    this.returnType = returnType;
    this.initialized = false;
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

    // Register built-in standard library functions
    this.registerBuiltins();
  }

  registerBuiltins() {
    const builtins = [
      { name: 'print', type: 'void', kind: 'function', params: [{ type: 'any' }], returnType: 'void' },
      { name: 'printf', type: 'void', kind: 'function', params: [{ type: 'any' }], returnType: 'void' },
      { name: 'scanf', type: 'int', kind: 'function', params: [{ type: 'any' }], returnType: 'int' },
      { name: 'input', type: 'int', kind: 'function', params: [], returnType: 'int' }
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
        returnType: b.returnType
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

    // Pass 1: Register top-level function declarations & global variables for forward references
    for (const decl of ast.declarations || []) {
      if (decl.type === 'FunctionDeclaration') {
        this.declareFunction(decl);
      } else if (decl.type === 'VariableDeclaration') {
        this.declareGlobalVariables(decl);
      } else if (decl.type === 'ArrayDeclaration') {
        this.declareGlobalArray(decl);
      }
    }

    // Pass 2: Analyze function bodies and top-level statements
    for (const decl of ast.declarations || []) {
      if (decl.type === 'FunctionDeclaration') {
        this.analyzeFunction(decl);
      } else if (!['VariableDeclaration', 'ArrayDeclaration'].includes(decl.type)) {
        this.analyzeStatement(decl);
      }
    }

    // Verification check for main function
    const mainSym = this.globalScope.resolve('main');
    if (!mainSym || mainSym.kind !== 'function') {
      this.passedChecks.push({
        name: 'Entry Point Check',
        message: "No explicit 'main()' declared. Compiler automatically synthesizes a top-level 'main()' entry point."
      });
    } else {
      this.passedChecks.push({
        name: 'Entry Point Check',
        message: `Function 'main()' defined with return type '${mainSym.returnType}'.`
      });
    }

    if (this.errors.length === 0) {
      this.passedChecks.push({
        name: 'Identifier Resolution',
        message: 'All identifier references and function calls resolved successfully.'
      });
      this.passedChecks.push({
        name: 'Type Safety',
        message: 'All assignments and operations satisfy type compatibility requirements.'
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
          isBuiltin: sym.line === 0
        });
      }
    }
    return list;
  }

  // -------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------

  declareFunction(node) {
    if (this.currentScope.hasLocal(node.name)) {
      this.addError(node, `Redeclaration of function '${node.name}' in the same scope.`, `Use a different name or remove duplicate definition.`);
      return;
    }

    const sym = new SymbolInfo({
      name: node.name,
      type: node.returnType,
      kind: 'function',
      scopeLevel: this.currentScope.level,
      scopeName: this.currentScope.name,
      line: node.line,
      col: node.col,
      params: (node.params || []).map(p => ({ name: p.name, type: p.dataType, isArray: p.isArray })),
      returnType: node.returnType
    });

    this.currentScope.define(node.name, sym);
  }

  declareGlobalVariables(node) {
    for (const declarator of node.declarations || []) {
      const name = declarator.id.name;
      if (this.currentScope.hasLocal(name)) {
        this.addError(declarator, `Redeclaration of global variable '${name}'.`, `Remove duplicate variable declaration.`);
        continue;
      }
      const sym = new SymbolInfo({
        name,
        type: node.dataType,
        kind: 'variable',
        scopeLevel: 0,
        scopeName: 'Global',
        line: declarator.line,
        col: declarator.col
      });
      if (declarator.init) {
        const initType = this.analyzeExpression(declarator.init);
        this.checkTypeCompatibility(node.dataType, initType, declarator);
        sym.initialized = true;
      }
      this.currentScope.define(name, sym);
    }
  }

  declareGlobalArray(node) {
    if (this.currentScope.hasLocal(node.name)) {
      this.addError(node, `Redeclaration of identifier '${node.name}'.`);
      return;
    }
    const sym = new SymbolInfo({
      name: node.name,
      type: `${node.dataType}[]`,
      kind: 'array',
      scopeLevel: 0,
      scopeName: 'Global',
      line: node.line,
      col: node.col,
      size: node.size
    });
    this.currentScope.define(node.name, sym);
  }

  analyzeFunction(node) {
    this.currentFunction = node;
    const funcScope = new Scope(`Function (${node.name})`, this.currentScope.level + 1, this.currentScope);
    this.allScopes.push(funcScope);
    this.currentScope = funcScope;

    // Register parameters into function scope
    for (const param of node.params || []) {
      if (funcScope.hasLocal(param.name)) {
        this.addError(param, `Duplicate parameter name '${param.name}' in function '${node.name}'.`);
        continue;
      }
      const paramSym = new SymbolInfo({
        name: param.name,
        type: param.isArray ? `${param.dataType}[]` : param.dataType,
        kind: 'parameter',
        scopeLevel: funcScope.level,
        scopeName: funcScope.name,
        line: param.line,
        col: param.col
      });
      paramSym.initialized = true;
      funcScope.define(param.name, paramSym);
    }

    // Analyze function body
    let hasReturn = false;
    if (node.body) {
      hasReturn = this.analyzeBlock(node.body, false);
    }

    // Check return statement for non-void function
    if (node.returnType !== 'void' && !hasReturn) {
      this.warnings.push({
        phase: 'Semantic',
        line: node.line,
        col: node.col,
        message: `Function '${node.name}' has non-void return type '${node.returnType}' but might not return a value on all code paths.`,
        suggestion: `Add 'return ${node.returnType === 'bool' ? 'false' : '0'};' at the end of the function body.`
      });
      this.quickFixes.push({
        title: `Add return statement to '${node.name}'`,
        line: node.body ? (node.body.endLine || node.line) : node.line,
        patch: `\n    return 0;`
      });
    }

    this.currentScope = this.currentScope.parent;
    this.currentFunction = null;
  }

  // -------------------------------------------------------------
  // Blocks & Statements
  // -------------------------------------------------------------

  analyzeBlock(blockNode, createNewScope = true) {
    let blockScope = this.currentScope;
    if (createNewScope) {
      blockScope = new Scope(`Block (L${blockNode.line})`, this.currentScope.level + 1, this.currentScope);
      this.allScopes.push(blockScope);
      this.currentScope = blockScope;
    }

    let hasReturn = false;
    for (const stmt of blockNode.statements || []) {
      const returns = this.analyzeStatement(stmt);
      if (returns) hasReturn = true;
    }

    if (createNewScope) {
      this.currentScope = this.currentScope.parent;
    }

    return hasReturn;
  }

  analyzeStatement(stmt) {
    if (!stmt) return false;

    switch (stmt.type) {
      case 'BlockStatement':
        return this.analyzeBlock(stmt, true);

      case 'VariableDeclaration':
        this.analyzeVariableDeclaration(stmt);
        return false;

      case 'ArrayDeclaration':
        this.analyzeArrayDeclaration(stmt);
        return false;

      case 'ExpressionStatement':
        if (stmt.expression) {
          this.analyzeExpression(stmt.expression);
        }
        return false;

      case 'IfStatement':
        this.analyzeExpression(stmt.condition);
        const thenRet = this.analyzeStatement(stmt.thenBranch);
        const elseRet = stmt.elseBranch ? this.analyzeStatement(stmt.elseBranch) : false;
        return thenRet && elseRet;

      case 'WhileStatement':
      case 'DoWhileStatement':
        this.analyzeExpression(stmt.condition);
        this.analyzeStatement(stmt.body);
        return false;

      case 'ForStatement':
        const forScope = new Scope(`For-Loop (L${stmt.line})`, this.currentScope.level + 1, this.currentScope);
        this.allScopes.push(forScope);
        this.currentScope = forScope;

        if (stmt.init) {
          if (stmt.init.type === 'VariableDeclaration') {
            this.analyzeVariableDeclaration(stmt.init);
          } else {
            this.analyzeExpression(stmt.init);
          }
        }
        if (stmt.condition) this.analyzeExpression(stmt.condition);
        if (stmt.step) this.analyzeExpression(stmt.step);
        if (stmt.body) this.analyzeStatement(stmt.body);

        this.currentScope = this.currentScope.parent;
        return false;

      case 'ReturnStatement':
        this.analyzeReturnStatement(stmt);
        return true;

      case 'BreakStatement':
      case 'ContinueStatement':
      case 'EmptyStatement':
        return false;

      default:
        return false;
    }
  }

  analyzeVariableDeclaration(node) {
    for (const declarator of node.declarations || []) {
      const name = declarator.id.name;
      if (this.currentScope.hasLocal(name)) {
        this.addError(declarator, `Redeclaration of variable '${name}' in the same scope.`, `Choose a unique variable name.`);
        continue;
      }

      const sym = new SymbolInfo({
        name,
        type: node.dataType,
        kind: 'variable',
        scopeLevel: this.currentScope.level,
        scopeName: this.currentScope.name,
        line: declarator.line,
        col: declarator.col
      });

      if (declarator.init) {
        const initType = this.analyzeExpression(declarator.init);
        this.checkTypeCompatibility(node.dataType, initType, declarator);
        sym.initialized = true;
      }

      this.currentScope.define(name, sym);
    }
  }

  analyzeArrayDeclaration(node) {
    if (this.currentScope.hasLocal(node.name)) {
      this.addError(node, `Redeclaration of '${node.name}' in the same scope.`);
      return;
    }

    if (node.sizeExpr) {
      const sizeType = this.analyzeExpression(node.sizeExpr);
      if (sizeType && sizeType !== 'int') {
        this.addError(node.sizeExpr, `Array dimension size must be an integer, found '${sizeType}'.`);
      }
    }

    if (node.elements && node.elements.length > 0) {
      for (const el of node.elements) {
        const elType = this.analyzeExpression(el);
        this.checkTypeCompatibility(node.dataType, elType, el);
      }
      if (node.size !== null && node.elements.length > node.size) {
        this.addError(node, `Too many initializers for array '${node.name}': declared size ${node.size}, but ${node.elements.length} elements provided.`);
      }
    }

    const sym = new SymbolInfo({
      name: node.name,
      type: `${node.dataType}[]`,
      kind: 'array',
      scopeLevel: this.currentScope.level,
      scopeName: this.currentScope.name,
      line: node.line,
      col: node.col,
      size: node.size
    });

    this.currentScope.define(node.name, sym);
  }

  analyzeReturnStatement(node) {
    if (!this.currentFunction) {
      this.addError(node, `'return' statement outside of any function.`);
      return;
    }

    const expectedType = this.currentFunction.returnType;

    if (!node.argument) {
      if (expectedType !== 'void') {
        this.addError(node, `Function '${this.currentFunction.name}' must return a value of type '${expectedType}'.`, `Add a return expression.`);
      }
      return;
    }

    if (expectedType === 'void') {
      this.addError(node, `Void function '${this.currentFunction.name}' should not return a value.`);
      return;
    }

    const actualType = this.analyzeExpression(node.argument);
    this.checkTypeCompatibility(expectedType, actualType, node);
  }

  // -------------------------------------------------------------
  // Expressions & Type Checking
  // -------------------------------------------------------------

  analyzeExpression(expr) {
    if (!expr) return null;

    switch (expr.type) {
      case 'Literal':
        return expr.dataType;

      case 'Identifier': {
        const sym = this.currentScope.resolve(expr.name);
        if (!sym) {
          this.addError(expr, `Undeclared identifier '${expr.name}'.`, `Declare '${expr.name}' before use.`);
          this.quickFixes.push({
            title: `Declare '${expr.name}' as int`,
            line: expr.line,
            col: expr.col,
            variableName: expr.name,
            patch: `int ${expr.name} = 0;\n`
          });
          return 'unknown';
        }
        sym.used = true;
        return sym.type;
      }

      case 'BinaryExpression': {
        const leftType = this.analyzeExpression(expr.left);
        const rightType = this.analyzeExpression(expr.right);
        const op = expr.operator;

        // Relational / Equality
        if (['==', '!=', '<', '<=', '>', '>='].includes(op)) {
          return 'bool';
        }

        // Arithmetic: +, -, *, /, %
        if (op === '%') {
          if (leftType !== 'int' || rightType !== 'int') {
            this.addError(expr, `Modulo operator '%' requires integer operands, found '${leftType}' and '${rightType}'.`);
          }
          return 'int';
        }

        // Float promotion
        if (leftType === 'float' || rightType === 'float') {
          return 'float';
        }

        return 'int';
      }

      case 'LogicalExpression': {
        this.analyzeExpression(expr.left);
        this.analyzeExpression(expr.right);
        return 'bool';
      }

      case 'UnaryExpression': {
        const subType = this.analyzeExpression(expr.argument);
        if (expr.operator === '!') return 'bool';
        return subType;
      }

      case 'UpdateExpression': {
        const argType = this.analyzeExpression(expr.argument);
        if (argType !== 'int' && argType !== 'float') {
          this.addError(expr, `Operator '${expr.operator}' can only be applied to numeric types.`);
        }
        return argType;
      }

      case 'AssignmentExpression': {
        let targetType = 'unknown';
        if (expr.left.type === 'Identifier') {
          const sym = this.currentScope.resolve(expr.left.name);
          if (!sym) {
            this.addError(expr.left, `Undeclared identifier '${expr.left.name}'.`);
            this.quickFixes.push({
              title: `Declare '${expr.left.name}' as int`,
              line: expr.left.line,
              col: expr.left.col,
              variableName: expr.left.name,
              patch: `int ${expr.left.name} = 0;\n`
            });
          } else {
            targetType = sym.type;
            sym.initialized = true;
          }
        } else if (expr.left.type === 'ArrayAccess') {
          targetType = this.analyzeExpression(expr.left);
        }

        const valueType = this.analyzeExpression(expr.right);
        this.checkTypeCompatibility(targetType, valueType, expr);
        return targetType;
      }

      case 'CallExpression': {
        const calleeName = expr.callee.name;
        const sym = this.currentScope.resolve(calleeName);

        if (!sym) {
          this.addError(expr, `Call to undeclared function '${calleeName}'.`, `Define function '${calleeName}' before calling it.`);
          return 'unknown';
        }

        if (sym.kind !== 'function') {
          this.addError(expr, `'${calleeName}' is a ${sym.kind}, not a function.`);
          return 'unknown';
        }

        // Parameter checks (built-ins like print accept variable arguments)
        if (calleeName !== 'print' && calleeName !== 'printf' && calleeName !== 'scanf') {
          const expectedParams = sym.params || [];
          const actualArgs = expr.arguments || [];

          if (expectedParams.length !== actualArgs.length) {
            this.addError(expr, `Function '${calleeName}' expects ${expectedParams.length} argument(s), but received ${actualArgs.length}.`);
          } else {
            for (let i = 0; i < expectedParams.length; i++) {
              const argType = this.analyzeExpression(actualArgs[i]);
              this.checkTypeCompatibility(expectedParams[i].type, argType, actualArgs[i]);
            }
          }
        } else {
          // Analyze arguments for built-in calls
          for (const arg of expr.arguments || []) {
            this.analyzeExpression(arg);
          }
        }

        return sym.returnType || sym.type;
      }

      case 'ArrayAccess': {
        const arraySym = this.currentScope.resolve(expr.array.name);
        if (!arraySym) {
          this.addError(expr.array, `Undeclared array '${expr.array.name}'.`);
          return 'unknown';
        }

        const indexType = this.analyzeExpression(expr.index);
        if (indexType && indexType !== 'int') {
          this.addError(expr.index, `Array index must be an integer, found '${indexType}'.`);
        }

        // Static bounds check if index is a constant number
        if (expr.index.type === 'Literal' && typeof expr.index.value === 'number' && arraySym.size !== null) {
          if (expr.index.value < 0 || expr.index.value >= arraySym.size) {
            this.warnings.push({
              phase: 'Semantic',
              line: expr.line,
              col: expr.col,
              message: `Static array index [${expr.index.value}] is out of bounds for array '${arraySym.name}[${arraySym.size}]'.`
            });
          }
        }

        // Return base element type
        return arraySym.type.replace('[]', '');
      }

      case 'GroupingExpression':
        return this.analyzeExpression(expr.expression);

      default:
        return 'unknown';
    }
  }

  checkTypeCompatibility(targetType, sourceType, node) {
    if (!targetType || !sourceType || targetType === 'unknown' || sourceType === 'unknown') {
      return;
    }

    if (targetType === sourceType) return;

    // Implicit cast: int to float
    if (targetType === 'float' && sourceType === 'int') {
      this.warnings.push({
        phase: 'Semantic',
        line: node.line,
        col: node.col,
        message: `Implicit conversion from 'int' to 'float'.`
      });
      return;
    }

    // Narrowing conversion: float to int warning
    if (targetType === 'int' && sourceType === 'float') {
      this.warnings.push({
        phase: 'Semantic',
        line: node.line,
        col: node.col,
        message: `Implicit conversion from 'float' to 'int' may truncate decimal precision.`
      });
      return;
    }

    // Incompatible types
    this.addError(node, `Type mismatch: cannot assign or convert '${sourceType}' to '${targetType}'.`);
  }

  addError(node, message, suggestion = '') {
    this.errors.push({
      phase: 'Semantic',
      line: node.line || 1,
      col: node.col || 1,
      length: node.length || (node.name ? node.name.length : 1),
      message,
      suggestion
    });
  }
}

// Export for browser and node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SemanticAnalyzer, Scope, SymbolInfo };
}


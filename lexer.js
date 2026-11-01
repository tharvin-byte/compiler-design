/**
 * CompilerLens - Lexical Analyzer (lexer.js)
 * Phase 1: Converts source code into a stream of tokens, strips/counts comments,
 * tracks line:column coordinates, and provides token statistics and lexical error handling.
 */

const TokenType = {
  KEYWORD: 'KEYWORD',
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  FLOAT: 'FLOAT',
  STRING: 'STRING',
  CHAR: 'CHAR',
  BOOLEAN: 'BOOLEAN',
  OPERATOR: 'OPERATOR',
  PUNCTUATION: 'PUNCTUATION',
  COMMENT: 'COMMENT',
  EOF: 'EOF'
};

const KEYWORDS = new Set([
  'int', 'float', 'char', 'bool', 'void',
  'if', 'else', 'while', 'for', 'do',
  'break', 'continue', 'return',
  'print', 'printf', 'scanf', 'input',
  'true', 'false'
]);

const MULTI_CHAR_OPS = [
  '==', '!=', '<=', '>=', '&&', '||',
  '++', '--', '+=', '-=', '*=', '/=', '%='
];

const SINGLE_CHAR_OPS = ['+', '-', '*', '/', '%', '<', '>', '!', '='];

const PUNCTUATIONS = [';', ',', '(', ')', '{', '}', '[', ']'];

class Token {
  constructor(type, value, line, col, length = value.length, raw = value) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
    this.length = length;
    this.raw = raw;
  }
}

class Lexer {
  constructor(source = '') {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.comments = [];
    this.errors = [];
    this.stats = {
      totalTokens: 0,
      byType: {},
      linesOfCode: 0,
      commentCount: 0,
      charCount: source.length
    };
  }

  tokenize(source) {
    if (source !== undefined) {
      this.source = source;
    }
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.comments = [];
    this.errors = [];

    // Calculate total lines
    this.stats.linesOfCode = this.source.split(/\r\n|\r|\n/).length;

    while (this.pos < this.source.length) {
      const char = this.source[this.pos];

      // Whitespace
      if (char === ' ' || char === '\t' || char === '\r') {
        this.advance();
        continue;
      }

      // Newlines
      if (char === '\n') {
        this.line++;
        this.col = 1;
        this.pos++;
        continue;
      }

      // Single-line comment: //
      if (char === '/' && this.peek() === '/') {
        const startLine = this.line;
        const startCol = this.col;
        let commentText = '';
        this.advance(); // consume first '/'
        this.advance(); // consume second '/'
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          commentText += this.source[this.pos];
          this.advance();
        }
        this.comments.push({
          type: 'single-line',
          text: '//' + commentText,
          line: startLine,
          col: startCol
        });
        continue;
      }

      // Multi-line comment: /* ... */
      if (char === '/' && this.peek() === '*') {
        const startLine = this.line;
        const startCol = this.col;
        let commentText = '';
        this.advance(); // consume '/'
        this.advance(); // consume '*'
        let closed = false;
        while (this.pos < this.source.length) {
          if (this.source[this.pos] === '*' && this.peek() === '/') {
            this.advance(); // consume '*'
            this.advance(); // consume '/'
            closed = true;
            break;
          }
          if (this.source[this.pos] === '\n') {
            this.line++;
            this.col = 1;
            this.pos++;
            commentText += '\n';
          } else {
            commentText += this.source[this.pos];
            this.advance();
          }
        }
        if (!closed) {
          this.errors.push({
            phase: 'Lexical',
            line: startLine,
            col: startCol,
            message: 'Unterminated multi-line comment: expected "*/" before end of file.',
            suggestion: 'Add "*/" to close the block comment.'
          });
        }
        this.comments.push({
          type: 'multi-line',
          text: '/*' + commentText + (closed ? '*/' : ''),
          line: startLine,
          col: startCol
        });
        continue;
      }

      // String literal: "..."
      if (char === '"') {
        this.scanString();
        continue;
      }

      // Character literal: '...'
      if (char === "'") {
        this.scanChar();
        continue;
      }

      // Numbers: integer or float
      if (this.isDigit(char) || (char === '.' && this.isDigit(this.peek()))) {
        this.scanNumber();
        continue;
      }

      // Identifiers and Keywords
      if (this.isAlphaOrUnderscore(char)) {
        this.scanIdentifier();
        continue;
      }

      // Multi-character Operators
      const twoChar = char + (this.peek() || '');
      if (MULTI_CHAR_OPS.includes(twoChar)) {
        this.addToken(TokenType.OPERATOR, twoChar, 2);
        this.advance();
        this.advance();
        continue;
      }

      // Single-character Operators
      if (SINGLE_CHAR_OPS.includes(char)) {
        this.addToken(TokenType.OPERATOR, char, 1);
        this.advance();
        continue;
      }

      // Punctuation
      if (PUNCTUATIONS.includes(char)) {
        this.addToken(TokenType.PUNCTUATION, char, 1);
        this.advance();
        continue;
      }

      // Unknown character error
      this.errors.push({
        phase: 'Lexical',
        line: this.line,
        col: this.col,
        message: `Unexpected character: '${char}' (ASCII ${char.charCodeAt(0)})`,
        suggestion: `Remove or replace the character '${char}'.`
      });
      this.advance();
    }

    // Add EOF token
    this.tokens.push(new Token(TokenType.EOF, '<EOF>', this.line, this.col, 0));

    // Compute stats
    this.computeStats();

    return {
      tokens: this.tokens,
      comments: this.comments,
      errors: this.errors,
      stats: this.stats
    };
  }

  advance() {
    this.pos++;
    this.col++;
  }

  peek(offset = 1) {
    if (this.pos + offset >= this.source.length) return null;
    return this.source[this.pos + offset];
  }

  isDigit(c) {
    return c !== null && c >= '0' && c <= '9';
  }

  isAlphaOrUnderscore(c) {
    return c !== null && (
      (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      c === '_'
    );
  }

  isAlphaNumeric(c) {
    return this.isAlphaOrUnderscore(c) || this.isDigit(c);
  }

  addToken(type, value, length, raw = value) {
    this.tokens.push(new Token(type, value, this.line, this.col, length, raw));
  }

  scanString() {
    const startLine = this.line;
    const startCol = this.col;
    let val = '';
    let raw = '"';
    this.advance(); // consume opening quote

    let escaped = false;
    let closed = false;

    while (this.pos < this.source.length) {
      const c = this.source[this.pos];
      raw += c;

      if (c === '\n') {
        this.line++;
        this.col = 1;
        this.pos++;
        // C strings cannot cross lines without backslash
        if (!escaped) {
          this.errors.push({
            phase: 'Lexical',
            line: startLine,
            col: startCol,
            message: 'Unterminated string literal: string cannot span multiple lines without escape.',
            suggestion: 'Add closing double quote " before the newline.'
          });
          return;
        }
        val += '\n';
        escaped = false;
        continue;
      }

      if (escaped) {
        if (c === 'n') val += '\n';
        else if (c === 't') val += '\t';
        else if (c === 'r') val += '\r';
        else if (c === '\\') val += '\\';
        else if (c === '"') val += '"';
        else if (c === '0') val += '\0';
        else val += c;
        escaped = false;
        this.advance();
        continue;
      }

      if (c === '\\') {
        escaped = true;
        this.advance();
        continue;
      }

      if (c === '"') {
        this.advance();
        closed = true;
        break;
      }

      val += c;
      this.advance();
    }

    if (!closed) {
      this.errors.push({
        phase: 'Lexical',
        line: startLine,
        col: startCol,
        message: 'Unterminated string literal at end of file.',
        suggestion: 'Add closing double quote " to terminate the string.'
      });
      return;
    }

    this.tokens.push(new Token(TokenType.STRING, val, startLine, startCol, raw.length, raw));
  }

  scanChar() {
    const startLine = this.line;
    const startCol = this.col;
    let raw = "'";
    let val = '';
    this.advance(); // consume opening single quote

    let escaped = false;
    let closed = false;

    while (this.pos < this.source.length) {
      const c = this.source[this.pos];
      raw += c;

      if (c === '\n') {
        this.errors.push({
          phase: 'Lexical',
          line: startLine,
          col: startCol,
          message: 'Unterminated character literal.',
          suggestion: 'Add closing single quote \'.'
        });
        return;
      }

      if (escaped) {
        if (c === 'n') val = '\n';
        else if (c === 't') val = '\t';
        else if (c === '\\') val = '\\';
        else if (c === "'") val = "'";
        else val = c;
        escaped = false;
        this.advance();
        continue;
      }

      if (c === '\\') {
        escaped = true;
        this.advance();
        continue;
      }

      if (c === "'") {
        this.advance();
        closed = true;
        break;
      }

      val += c;
      this.advance();
    }

    if (!closed) {
      this.errors.push({
        phase: 'Lexical',
        line: startLine,
        col: startCol,
        message: 'Unterminated character literal.',
        suggestion: 'Add closing single quote \'.'
      });
      return;
    }

    this.tokens.push(new Token(TokenType.CHAR, val, startLine, startCol, raw.length, raw));
  }

  scanNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let numStr = '';
    let isFloat = false;

    while (this.pos < this.source.length) {
      const c = this.source[this.pos];
      if (this.isDigit(c)) {
        numStr += c;
        this.advance();
      } else if (c === '.' && !isFloat && this.isDigit(this.peek())) {
        isFloat = true;
        numStr += c;
        this.advance();
      } else {
        break;
      }
    }

    // Exponential notation (e.g. 1.5e-3)
    if (this.source[this.pos] === 'e' || this.source[this.pos] === 'E') {
      const next = this.peek();
      if (this.isDigit(next) || next === '+' || next === '-') {
        isFloat = true;
        numStr += this.source[this.pos];
        this.advance();
        if (this.source[this.pos] === '+' || this.source[this.pos] === '-') {
          numStr += this.source[this.pos];
          this.advance();
        }
        while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
          numStr += this.source[this.pos];
          this.advance();
        }
      }
    }

    const type = isFloat ? TokenType.FLOAT : TokenType.NUMBER;
    const parsedVal = isFloat ? parseFloat(numStr) : parseInt(numStr, 10);
    this.tokens.push(new Token(type, parsedVal, startLine, startCol, numStr.length, numStr));
  }

  scanIdentifier() {
    const startLine = this.line;
    const startCol = this.col;
    let idStr = '';

    while (this.pos < this.source.length && this.isAlphaNumeric(this.source[this.pos])) {
      idStr += this.source[this.pos];
      this.advance();
    }

    if (KEYWORDS.has(idStr)) {
      if (idStr === 'true' || idStr === 'false') {
        this.tokens.push(new Token(TokenType.BOOLEAN, idStr === 'true', startLine, startCol, idStr.length, idStr));
      } else {
        this.tokens.push(new Token(TokenType.KEYWORD, idStr, startLine, startCol, idStr.length, idStr));
      }
    } else {
      this.tokens.push(new Token(TokenType.IDENTIFIER, idStr, startLine, startCol, idStr.length, idStr));
    }
  }

  computeStats() {
    this.stats.totalTokens = this.tokens.filter(t => t.type !== TokenType.EOF).length;
    this.stats.commentCount = this.comments.length;
    this.stats.byType = {};

    for (const t of this.tokens) {
      if (t.type === TokenType.EOF) continue;
      this.stats.byType[t.type] = (this.stats.byType[t.type] || 0) + 1;
    }
  }
}

// Export for browser and node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Lexer, Token, TokenType, KEYWORDS };
}

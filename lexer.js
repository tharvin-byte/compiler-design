/**
 * CompilerLens - MiniRuby Lexical Analyzer (lexer.js)
 * Phase 1: Converts MiniRuby source code into a stream of tokens,
 * strips and counts comments (# and =begin...=end), tracks line:column coordinates,
 * identifies newlines as statement separators, and produces token statistics and diagnostics.
 */

const TokenType = {
  KEYWORD: 'KEYWORD',
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  FLOAT: 'FLOAT',
  STRING: 'STRING',
  BOOLEAN: 'BOOLEAN',
  NIL: 'NIL',
  OPERATOR: 'OPERATOR',
  PUNCTUATION: 'PUNCTUATION',
  NEWLINE: 'NEWLINE',
  COMMENT: 'COMMENT',
  EOF: 'EOF'
};

const KEYWORDS = new Set([
  'def', 'end', 'if', 'elsif', 'else', 'while', 'return',
  'puts', 'print', 'gets', 'true', 'false', 'nil',
  'and', 'or', 'not', 'break', 'next'
]);

const MULTI_CHAR_OPS = [
  '**=', '==', '!=', '<=', '>=', '&&', '||',
  '**', '+=', '-=', '*=', '/=', '%='
];

const SINGLE_CHAR_OPS = ['+', '-', '*', '/', '%', '<', '>', '!', '='];

const PUNCTUATIONS = [';', ',', '(', ')', '[', ']', '.', ':'];

class Token {
  constructor(type, value, line, col, length = String(value).length, raw = value) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
    this.length = length;
    this.raw = raw;
  }

  toString() {
    return `${this.type}(${this.value}) [L${this.line}:${this.col}]`;
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
    this.stats = {
      totalTokens: 0,
      byType: {},
      linesOfCode: 0,
      commentCount: 0,
      charCount: this.source.length
    };

    // Calculate total lines
    this.stats.linesOfCode = this.source.split(/\r\n|\r|\n/).length;

    while (this.pos < this.source.length) {
      const char = this.source[this.pos];

      // Whitespace (horizontal)
      if (char === ' ' || char === '\t' || char === '\r') {
        this.advance();
        continue;
      }

      // Newlines (significant in Ruby as statement separators)
      if (char === '\n') {
        const startLine = this.line;
        const startCol = this.col;
        this.line++;
        this.col = 1;
        this.pos++;

        // Emit NEWLINE only if the previous token wasn't already a NEWLINE or open grouping
        if (this.tokens.length > 0) {
          const lastTok = this.tokens[this.tokens.length - 1];
          const skipAfter = ['NEWLINE', 'OPERATOR'];
          const isPunctOpen = lastTok.type === 'PUNCTUATION' && (lastTok.value === '(' || lastTok.value === '[' || lastTok.value === ',');
          if (!skipAfter.includes(lastTok.type) && !isPunctOpen) {
            this.tokens.push(new Token(TokenType.NEWLINE, '\n', startLine, startCol, 1, '\\n'));
          }
        }
        continue;
      }

      // Multi-line block comments in Ruby: =begin ... =end at the start of a line
      if (this.col === 1 && char === '=' && this.source.startsWith('=begin', this.pos)) {
        const startLine = this.line;
        const startCol = this.col;
        let commentText = '';
        while (this.pos < this.source.length) {
          if (this.source[this.pos] === '\n') {
            this.line++;
            this.col = 1;
            this.pos++;
            if (this.source.startsWith('=end', this.pos)) {
              // Consume =end and rest of line
              while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
                this.pos++;
              }
              break;
            }
          } else {
            commentText += this.source[this.pos];
            this.pos++;
            this.col++;
          }
        }
        this.comments.push({
          type: 'block',
          text: commentText,
          line: startLine,
          col: startCol
        });
        this.stats.commentCount++;
        continue;
      }

      // Ruby Single-Line Comment: # to end of line
      if (char === '#') {
        const startLine = this.line;
        const startCol = this.col;
        let commentText = '';
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          commentText += this.source[this.pos];
          this.advance();
        }
        this.comments.push({
          type: 'single',
          text: commentText,
          line: startLine,
          col: startCol
        });
        this.stats.commentCount++;
        continue;
      }

      // String literal: double quotes ("...") or single quotes ('...')
      if (char === '"' || char === "'") {
        this.scanString(char);
        continue;
      }

      // Numbers: integer and float
      if (this.isDigit(char)) {
        this.scanNumber();
        continue;
      }

      // Identifiers and Keywords
      if (this.isAlpha(char) || char === '_') {
        this.scanIdentifier();
        continue;
      }

      // Multi-character operators
      let matchedMulti = false;
      for (const op of MULTI_CHAR_OPS) {
        if (this.source.startsWith(op, this.pos)) {
          this.tokens.push(new Token(TokenType.OPERATOR, op, this.line, this.col, op.length, op));
          this.advance(op.length);
          matchedMulti = true;
          break;
        }
      }
      if (matchedMulti) continue;

      // Single-character operators
      if (SINGLE_CHAR_OPS.includes(char)) {
        this.tokens.push(new Token(TokenType.OPERATOR, char, this.line, this.col, 1, char));
        this.advance();
        continue;
      }

      // Punctuations: ;, ,, (, ), [, ], ., :
      if (PUNCTUATIONS.includes(char)) {
        this.tokens.push(new Token(TokenType.PUNCTUATION, char, this.line, this.col, 1, char));
        this.advance();
        continue;
      }

      // Unrecognized lexical character
      this.errors.push({
        line: this.line,
        col: this.col,
        length: 1,
        message: `Unexpected character: '${char}' (ASCII ${char.charCodeAt(0)})`,
        raw: char
      });
      this.advance();
    }

    // Append EOF token
    this.tokens.push(new Token(TokenType.EOF, '<EOF>', this.line, this.col, 0, ''));

    // Compute token statistics
    this.stats.totalTokens = this.tokens.length;
    this.stats.byType = {};
    for (const t of this.tokens) {
      this.stats.byType[t.type] = (this.stats.byType[t.type] || 0) + 1;
    }

    return {
      tokens: this.tokens,
      comments: this.comments,
      errors: this.errors,
      stats: this.stats
    };
  }

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------

  advance(count = 1) {
    for (let i = 0; i < count; i++) {
      if (this.pos < this.source.length) {
        this.pos++;
        this.col++;
      }
    }
  }

  peek(offset = 1) {
    const idx = this.pos + offset;
    return idx < this.source.length ? this.source[idx] : '\0';
  }

  isDigit(c) {
    return c >= '0' && c <= '9';
  }

  isAlpha(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  }

  isAlphaNumeric(c) {
    return this.isAlpha(c) || this.isDigit(c) || c === '_';
  }

  scanString(quoteChar) {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // Skip opening quote
    let strVal = '';

    while (this.pos < this.source.length && this.source[this.pos] !== quoteChar) {
      if (this.source[this.pos] === '\n') {
        this.errors.push({
          line: startLine,
          col: startCol,
          length: this.col - startCol,
          message: `Unterminated string literal starting at line ${startLine}, col ${startCol}`
        });
        return;
      }

      // Handle escape sequences
      if (this.source[this.pos] === '\\' && this.pos + 1 < this.source.length) {
        this.advance();
        const esc = this.source[this.pos];
        switch (esc) {
          case 'n': strVal += '\n'; break;
          case 't': strVal += '\t'; break;
          case 'r': strVal += '\r'; break;
          case '\\': strVal += '\\'; break;
          case '"': strVal += '"'; break;
          case "'": strVal += "'"; break;
          default: strVal += esc; break;
        }
        this.advance();
      } else {
        strVal += this.source[this.pos];
        this.advance();
      }
    }

    if (this.pos >= this.source.length) {
      this.errors.push({
        line: startLine,
        col: startCol,
        length: this.col - startCol,
        message: `Unterminated string literal starting at line ${startLine}, col ${startCol}`
      });
      return;
    }

    this.advance(); // Skip closing quote
    const rawLen = this.col - startCol;
    this.tokens.push(new Token(TokenType.STRING, strVal, startLine, startCol, rawLen, `"${strVal}"`));
  }

  scanNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let numStr = '';
    let isFloat = false;

    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      numStr += this.source[this.pos];
      this.advance();
    }

    // Check for fractional part
    if (this.pos < this.source.length && this.source[this.pos] === '.' && this.isDigit(this.peek())) {
      isFloat = true;
      numStr += '.';
      this.advance(); // consume '.'
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        numStr += this.source[this.pos];
        this.advance();
      }
    }

    const type = isFloat ? TokenType.FLOAT : TokenType.NUMBER;
    const val = isFloat ? parseFloat(numStr) : parseInt(numStr, 10);
    this.tokens.push(new Token(type, val, startLine, startCol, numStr.length, numStr));
  }

  scanIdentifier() {
    const startLine = this.line;
    const startCol = this.col;
    let id = '';

    while (this.pos < this.source.length && this.isAlphaNumeric(this.source[this.pos])) {
      id += this.source[this.pos];
      this.advance();
    }

    // Check if keyword
    if (KEYWORDS.has(id)) {
      if (id === 'true' || id === 'false') {
        this.tokens.push(new Token(TokenType.BOOLEAN, id === 'true', startLine, startCol, id.length, id));
      } else if (id === 'nil') {
        this.tokens.push(new Token(TokenType.NIL, null, startLine, startCol, id.length, id));
      } else if (id === 'and' || id === 'or' || id === 'not') {
        // Map word logical operators to operator token
        const opVal = id === 'and' ? '&&' : (id === 'or' ? '||' : '!');
        this.tokens.push(new Token(TokenType.OPERATOR, opVal, startLine, startCol, id.length, id));
      } else {
        this.tokens.push(new Token(TokenType.KEYWORD, id, startLine, startCol, id.length, id));
      }
    } else {
      this.tokens.push(new Token(TokenType.IDENTIFIER, id, startLine, startCol, id.length, id));
    }
  }
}

// Export for Node.js test suites
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Lexer, Token, TokenType };
}

"""Read Lua table literals in Python, without running any Lua.

Questie's data files are Lua source. Everything this project needs from them
is plain data: numbers, strings, nil, nested tables, and named constants such
as `questKeys.name` or `zoneIDs.ASHENVALE + 1`. This module parses that subset.

Tables come back as:
- a list when every entry is positional (`{1, nil, 3}` -> [1, None, 3]),
- a dict when any entry has an explicit key (`{[12] = {...}}`).

Names are looked up in the `names` mapping given to parse(). A dotted name that
isn't known evaluates to UNKNOWN, and arithmetic on UNKNOWN stays UNKNOWN, so
one exotic constant never breaks a whole file.
"""
import re


class _Unknown:
    def __repr__(self):
        return "UNKNOWN"


UNKNOWN = _Unknown()

_TOKEN = re.compile(r'''
    (?P<ws>\s+)
  | (?P<comment>--\[\[.*?\]\]|--[^\n]*)
  | (?P<lstr>\[\[.*?\]\])
  | (?P<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
  | (?P<num>0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)
  | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<sym>\.\.|[{}\[\]=,;()+\-*/.:])
''', re.X | re.S)

_ESC = {"n": "\n", "t": "\t", "r": "\r", "a": "", "b": "", "f": "", "v": ""}


def _unescape(s):
    if "\\" not in s:
        return s
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            n = s[i + 1]
            m = re.match(r"\d{1,3}", s[i + 1:])
            if m:
                out.append(chr(int(m.group(0))))
                i += 1 + len(m.group(0))
                continue
            out.append(_ESC.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def tokenize(text):
    toks, pos, n = [], 0, len(text)
    while pos < n:
        m = _TOKEN.match(text, pos)
        if not m:
            raise ValueError("can't read Lua at offset %d: %r" % (pos, text[pos:pos + 40]))
        pos = m.end()
        kind = m.lastgroup
        if kind in ("ws", "comment"):
            continue
        v = m.group(kind)
        if kind == "lstr":
            toks.append(("str", v[2:-2]))
        elif kind == "str":
            toks.append(("str", _unescape(v[1:-1])))
        elif kind == "num":
            toks.append(("num", int(v, 0) if re.fullmatch(r"0[xX][0-9a-fA-F]+|\d+", v) else float(v)))
        else:
            toks.append((kind, v))
    return toks


_WORDS = {"nil": None, "true": True, "false": False}


class Parser:
    def __init__(self, toks, names=None):
        self.toks = toks
        self.i = 0
        self.names = names or {}

    def peek(self, ahead=0):
        j = self.i + ahead
        return self.toks[j] if j < len(self.toks) else (None, None)

    def take(self, sym=None):
        tok = self.peek()
        if sym is not None and tok != ("sym", sym):
            raise ValueError("expected %r, found %r" % (sym, tok[1]))
        self.i += 1
        return tok

    def at(self, sym):
        return self.peek() == ("sym", sym)

    # expr := term (('+' | '-' | '*' | '/' | '..') term)*   (left to right)
    def expr(self):
        v = self.term()
        while self.peek()[0] == "sym" and self.peek()[1] in ("+", "-", "*", "/", ".."):
            op = self.take()[1]
            r = self.term()
            if v is UNKNOWN or r is UNKNOWN or v is None or r is None:
                v = UNKNOWN
            elif op == "..":
                v = "%s%s" % (v, r)
            elif op == "+":
                v = v + r
            elif op == "-":
                v = v - r
            elif op == "*":
                v = v * r
            else:
                v = v / r
        return v

    def term(self):
        kind, v = self.take()
        if kind in ("str", "num"):
            return v
        if kind == "sym":
            if v == "{":
                return self.table()
            if v == "-":
                r = self.term()
                return UNKNOWN if r is UNKNOWN or r is None else -r
            if v == "(":
                r = self.expr()
                self.take(")")
                return r
            raise ValueError("unexpected %r" % v)
        if kind == "name":
            if v in _WORDS and not self.at("."):
                return _WORDS[v]
            path = [v]
            while self.at(".") or self.at(":"):
                self.take()
                path.append(self.take()[1])
            val = self.names.get(path[0], UNKNOWN) if len(path) == 1 else UNKNOWN
            if len(path) > 1:
                cur = self.names.get(path[0])
                for p in path[1:]:
                    cur = cur.get(p) if isinstance(cur, dict) else None
                    if cur is None:
                        break
                val = UNKNOWN if cur is None else cur
            while self.at("(") or self.at("["):
                if self.at("("):  # a call: l10n("text") is its text, others unknown
                    self.take()
                    args = []
                    while not self.at(")"):
                        args.append(self.expr())
                        if self.at(","):
                            self.take()
                        elif not self.at(")"):
                            raise ValueError("expected ',' or ')', found %r" % (self.peek()[1],))
                    self.take(")")
                    val = args[0] if path[-1] == "l10n" and args and isinstance(args[0], str) else UNKNOWN
                else:
                    self.take()
                    key = self.expr()
                    self.take("]")
                    val = val.get(key, UNKNOWN) if isinstance(val, dict) else UNKNOWN
            return val
        raise ValueError("unexpected end of input")

    def table(self):
        """The rest of a table, after its '{'."""
        items, keyed, pos = [], {}, 0
        while True:
            if self.at("}"):
                self.take()
                break
            if self.at("["):
                self.take()
                key = self.expr()
                self.take("]")
                self.take("=")
                keyed[key] = self.expr()
            elif self.peek()[0] == "name" and self.peek(1) == ("sym", "="):
                key = self.take()[1]
                self.take()
                keyed[key] = self.expr()
            else:
                pos += 1
                items.append(self.expr())
            if self.at(",") or self.at(";"):
                self.take()
            elif not self.at("}"):
                raise ValueError("expected ',' or '}', found %r" % (self.peek()[1],))
        if not keyed:
            return items
        for n, v in enumerate(items, 1):
            keyed.setdefault(n, v)
        return keyed


def parse(text, names=None):
    """The value of one Lua expression."""
    p = Parser(tokenize(text), names)
    v = p.expr()
    return v

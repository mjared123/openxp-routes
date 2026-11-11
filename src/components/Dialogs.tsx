import { useEffect, useRef, useState, type ReactNode } from "react";
import { decodeShareString, encodeShareString, extractGuides, parseGuide, serializeGuide, SHARE_PREFIX, type Guide } from "../guide";
import { Icon } from "./Icon";

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <header>
        <h2>{title}</h2>
        <button className="ghost" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="primary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked: the text is selectable in the box above
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : label}
    </button>
  );
}

function fileName(name: string): string {
  return (name.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "route") + ".lua";
}

export function ExportDialog({ guide, name, onClose }: { guide: Guide; name: string; onClose: () => void }) {
  const [tab, setTab] = useState<"share" | "text" | "file">("share");
  const text = serializeGuide(guide);
  const share = encodeShareString([text]);
  const lua = `-- ${name}\n-- Made with OpenXP Routes\nRXPGuides.RegisterGuide([[\n${text}]])\n`;
  const empty = guide.steps.length === 0;

  return (
    <Dialog title="Export route" onClose={onClose}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "share"} onClick={() => setTab("share")}>
          Share string
        </button>
        <button role="tab" aria-selected={tab === "text"} onClick={() => setTab("text")}>
          Guide text
        </button>
        <button role="tab" aria-selected={tab === "file"} onClick={() => setTab("file")}>
          Addon file
        </button>
      </div>
      {empty && <p className="notice">This route has no steps yet.</p>}
      {tab === "share" && (
        <>
          <p>One line of text that holds the whole route. Send it to a friend, or paste it into Import here to keep working on it.</p>
          <textarea readOnly value={share} rows={5} onFocus={(e) => e.target.select()} />
          <footer>
            <CopyButton text={share} label="Copy share string" />
          </footer>
        </>
      )}
      {tab === "text" && (
        <>
          <p>The route in OpenXP's guide format, as you would write it by hand.</p>
          <textarea readOnly value={text} rows={14} className="mono" onFocus={(e) => e.target.select()} />
          <footer>
            <CopyButton text={text} label="Copy guide text" />
          </footer>
        </>
      )}
      {tab === "file" && (
        <>
          <p>
            A guide file for the OpenXP addon. Save it in the addon's <code>Guides</code> folder and add it to the guide list to
            load it in game.
          </p>
          <textarea readOnly value={lua} rows={10} className="mono" />
          <footer>
            <a className="button primary" download={fileName(name)} href={`data:text/plain;charset=utf-8,${encodeURIComponent(lua)}`}>
              <Icon name="download" /> Download {fileName(name)}
            </a>
          </footer>
        </>
      )}
    </Dialog>
  );
}

/** A guide from pasted text: a share string, an addon file, or plain guide text. */
export function readImport(input: string): { guide: Guide; more: number } {
  const text = input.trim();
  if (!text) throw new Error("Paste a share string or guide text first.");
  let guides: string[];
  if (text.startsWith(SHARE_PREFIX)) guides = decodeShareString(text);
  else if (/RegisterGuide\(\s*\[\[/.test(text)) guides = extractGuides(text);
  else guides = [text];
  const guide = parseGuide(guides[0] ?? "");
  if (!guide.steps.length) throw new Error("That doesn't look like a guide: it has no steps.");
  return { guide, more: guides.length - 1 };
}

export function ImportDialog({ hasSteps, onImport, onClose }: { hasSteps: boolean; onImport: (guide: Guide) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Import route" onClose={onClose}>
      <p>Paste a share string, guide text, or the contents of an addon guide file. You can also choose a file.</p>
      <textarea
        value={text}
        rows={10}
        className="mono"
        placeholder={"OXP1:…\n\nor\n\n#name My route\nstep\n    .goto Elwynn Forest,48.17,42.94\n    …"}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      {error && <p className="notice error">{error}</p>}
      {hasSteps && <p className="notice">Importing replaces the route you have now. Undo brings it back.</p>}
      <footer>
        <label className="button">
          <Icon name="upload" /> Choose a file
          <input
            type="file"
            accept=".lua,.txt"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setText(await file.text());
            }}
          />
        </label>
        <button
          className="primary"
          onClick={() => {
            try {
              const { guide } = readImport(text);
              onImport(guide);
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "That couldn't be read.");
            }
          }}
        >
          Import
        </button>
      </footer>
    </Dialog>
  );
}

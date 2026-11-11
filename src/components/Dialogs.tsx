import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Character } from "../character";
import { decodeShareString, encodeShareString, extractGuides, guideTag, parseGuide, serializeGuide, SHARE_PREFIX, type Guide } from "../guide";
import { exportGuides, projectFromGuides, type Project } from "../store";
import { Icon } from "./Icon";

export function Dialog({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? " wide" : ""}`}
      onClose={onClose}
      onCancel={(e) => !onClose && e.preventDefault()}
      onClick={(e) => e.target === ref.current && onClose?.()}
    >
      <header>
        <h2>{title}</h2>
        {onClose && (
          <button className="ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        )}
      </header>
      {children}
    </dialog>
  );
}

export interface PromptRequest {
  title: string;
  label: string;
  initial: string;
  onDone: (value: string) => void;
}

/** A one-line question, in place of the browser's own prompt box. */
export function PromptDialog({ request, onClose }: { request: PromptRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.initial);
  const done = () => {
    if (value.trim()) request.onDone(value.trim());
    onClose();
  };
  return (
    <Dialog title={request.title} onClose={onClose}>
      <label className="field stacked">
        <span>{request.label}</span>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && done()} />
      </label>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!value.trim()} onClick={done}>
          Add
        </button>
      </footer>
    </Dialog>
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

export function ExportDialog({ project, active, onClose }: { project: Project; active: number; onClose: () => void }) {
  const [tab, setTab] = useState<"share" | "text" | "file">("file");
  const many = project.sections.length > 1;
  const [whole, setWhole] = useState(true);
  const guides = exportGuides(project, many && !whole ? active : undefined);
  const texts = guides.map(serializeGuide);
  const text = texts.join("\n");
  const share = encodeShareString(texts);
  const name = many && !whole ? `${project.name} ${guideTag(guides[0]!, "name") ?? ""}` : project.name;
  const lua = `-- ${name}\n-- Made with OpenXP Routes\n${texts.map((t) => `RXPGuides.RegisterGuide([[\n${t}]])\n`).join("\n")}`;
  const empty = guides.every((g) => g.steps.length === 0);

  return (
    <Dialog title="Export route" onClose={onClose}>
      {many && (
        <div className="segmented export-scope" role="group" aria-label="What to export">
          <button className={whole ? "on" : ""} onClick={() => setWhole(true)}>
            Whole route ({project.sections.length} sections)
          </button>
          <button className={whole ? "" : "on"} onClick={() => setWhole(false)}>
            Only section {active + 1}
          </button>
        </div>
      )}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "file"} onClick={() => setTab("file")}>
          Addon file
        </button>
        <button role="tab" aria-selected={tab === "share"} onClick={() => setTab("share")}>
          Share string
        </button>
        <button role="tab" aria-selected={tab === "text"} onClick={() => setTab("text")}>
          Guide text
        </button>
      </div>
      {empty && <p className="notice">This route has no steps yet.</p>}
      {tab === "share" && (
        <>
          <p>One line of text that holds {many && whole ? "every section of the route" : "the route"}. Send it to a friend, or paste it into Import here to keep working on it.</p>
          <textarea readOnly value={share} rows={5} onFocus={(e) => e.target.select()} />
          <footer>
            <CopyButton text={share} label="Copy share string" />
          </footer>
        </>
      )}
      {tab === "text" && (
        <>
          <p>The route in OpenXP's guide format, as you would write it by hand.{many && whole ? " Each section is its own guide and leads to the next." : ""}</p>
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
            load it in game.{many && whole ? " Each section is its own guide and leads to the next." : ""}
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

/** Guides from pasted text: a share string, an addon file, or plain guide text. */
export function readImport(input: string): Guide[] {
  const text = input.trim();
  if (!text) throw new Error("Paste a share string or guide text first.");
  let texts: string[];
  if (text.startsWith(SHARE_PREFIX)) texts = decodeShareString(text);
  else if (/RegisterGuide\(\s*\[\[/.test(text)) texts = extractGuides(text);
  else texts = [text];
  const guides = texts.map(parseGuide).filter((g) => g.steps.length);
  if (!guides.length) throw new Error("That doesn't look like a guide: it has no steps.");
  return guides;
}

export function ImportDialog({ hasSteps, character, zoneByName, onImport, onClose }: { hasSteps: boolean; character: Character; zoneByName: Map<string, number>; onImport: (project: Project) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Import route" onClose={onClose}>
      <p>Paste a share string, guide text, or the contents of an addon guide file. You can also choose a file. A file with several guides becomes a route with several sections.</p>
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
              onImport(projectFromGuides(readImport(text), character, zoneByName));
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

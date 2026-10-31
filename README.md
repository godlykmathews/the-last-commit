# The Last Commit

A small, local museum of deleted code. Browse a file’s history, inspect its last version, and ask an open-weight model to tell its story—with references back to the evidence.

Built for **Ghost in the Machine**. The haunting lives in the history; the interface stays quiet.

## Run

Requires **Node.js 22+** and **Git**. There are no npm dependencies or build steps.

```sh
npm start
```

Open [127.0.0.1:3217](http://127.0.0.1:3217). The app starts with **Nightshift**, a fictional Git repository generated in `.data/nightshift`. Its files, dates, people, and commit messages are example material—not a real project’s history.

Use **Open repository** to enter an absolute path to your own local repository. Pick a deleted file to see its timeline, last version, and deletion diff. Setup and help stay behind the model button and corner help icon.

### Add a local narrator

Install and start [Ollama](https://ollama.com/download), then explicitly download a model, for example:

```sh
ollama pull qwen3:4b
```

Select the downloaded model in **Local model**, then choose **Summon story**. The app never downloads models itself. Browsing history works without Ollama; generating a story requires it. Inference speed depends on your hardware and model, and the archive remains usable while a story runs.

The integration uses Ollama’s [local API](https://docs.ollama.com/api/introduction) and [structured outputs](https://docs.ollama.com/capabilities/structured-outputs). Only downloaded local chat models are accepted; cloud aliases and remote models are rejected.

Optional configuration:

```sh
PORT=3218 OLLAMA_URL=http://127.0.0.1:11434 npm start
```

The app binds to `127.0.0.1`. `OLLAMA_URL` must be an HTTP loopback address.

## What it does

- Finds deleted paths that are absent from the repository’s current `HEAD`.
- Shows recorded commits, the last source before removal, and the deletion diff.
- Generates two short first-person lines, with a source reference and exact quotation for each.
- Checks that every cited source exists and every quote occurs in that source.
- Exports a standalone HTML exhibit, including the available story and evidence.
- Supports searching files and cancelling story generation, with no typewriter animation.

Stories are **AI interpretations**. Exact-quote validation cannot prove that a model’s conclusion follows from its quote. Read the referenced evidence; undocumented motives should stay unknown.

## Why open innovation matters

The narrator is a replaceable local model, not a hosted account requirement. [Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B) provides Apache-2.0 open weights, and [Ollama](https://github.com/ollama/ollama/blob/main/LICENSE) is MIT-licensed. The model is central to turning source and commit records into a readable, evidence-linked voice; Git supplies the records independently.

After installing the software and downloading a model, the intended workflow needs no internet connection. Private code can be interpreted without sending it to a hosted model, models can be swapped, and the prompt and validation rules in `lib/ollama.mjs` can be changed. Saved HTML exhibits remain readable without this app or a model service. Local inference has hardware and electricity costs, but this app requires no paid API.

## Data and boundaries

Your selected repository is read through Git commands; the app does not check out files, run project code, or change its commits or working tree. Repository sessions and detail caches live in server memory. The generated example is written under `.data/`, and exported exhibits are saved through your browser.

Story generation sends bounded commit and source excerpts to the local Ollama process. It does not redact secrets from those excerpts. The app serves its own assets and makes no hosted inference requests; Ollama’s own configuration, logs, and model storage remain under your control.

This is a bounded history viewer, not a complete repository audit:

- Scans history reachable from the opened `HEAD`, up to 300 deletion commits and 200 deleted paths. Other branches and uncommitted changes are not included.
- Reads at most 80 history records for a selected path. Missing earlier additions leave its first date unknown.
- Disables rename detection: a rename can appear as an old path’s deletion. It does not follow identities across renamed paths.
- Limits source and diff previews to 24,000 characters each, with smaller excerpts supplied to the model. Binary content and unusually large Git results may be unavailable.
- Uses the deletion commit’s first parent for the previous source. Complex merge history and shallow clones can give incomplete context.
- Does not search for surviving references or infer developer intent. Open the repository again after its history changes.
- Runs one story request at a time, with a 90-second generation timeout. Some models may fail the response validation.

## Development

```sh
npm run dev    # Restart the server after source changes
npm test       # Node's built-in test runner
npm run test:live # Real local-model smoke check (Ollama must be running)
npm run sample # Create or locate the fictional example repository
```

Automated tests use the generated example, temporary Git repositories, and mocked Ollama responses. The separate live check runs the installed model on the fictional session-store history, checks the purpose and documented replacement, and saves output under ignored `artifacts/`. It does not download models.

Verified October 31, 2026: all seven automated tests passed. A real local `qwen3:8b` run generated the two-line exhibit in 5.6 seconds with the model already loaded. Browser checks covered file search, source and diff views, evidence references, help, and 1280px and 390px layouts. These are observations on this machine, not performance guarantees.

The in-app browser's download-event check timed out, so the HTML export download has not been verified end to end in that browser.

The server and browser application use native Node.js and browser APIs. `lib/git.mjs` reads history; `lib/ollama.mjs` builds and validates stories; `public/` contains the interface.

Community reference: [RAG Beyond the Demo](https://dev.to/xinyangwuethz/rag-beyond-the-demo-pipeline-citations-evaluation-and-when-not-to-bother-3hoc) by [xinyangwuethz](https://dev.to/xinyangwuethz) distinguishes application-controlled source records from model-generated citation claims. The app follows that distinction: references resolve to Git records, while narration remains an interpretation.

## License

Application code is [MIT](LICENSE). Model weights are not bundled and retain their own licenses; Qwen3-4B’s Apache-2.0 license is separate from the application license. Repositories you open and their exported contents retain their existing rights and licenses.

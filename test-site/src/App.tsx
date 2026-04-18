import { Counter } from './Counter';
import { Roadmap } from './Roadmap';

export function App() {
  return (
    <div>
      <h1>Chorus — test surface</h1>
      <p>
        This page is where Chorus edits itself. The chorus script on this
        page is loaded via a relative path from <code>../packages/chorus/app.js</code> —
        so when you view this page on a feature branch, it runs the branch's
        version of the tool.
      </p>
      <p>
        Use the outer (black) Chorus trigger at the bottom-right to file
        tickets against <code>MarcusRobbins/chorus</code>. When the AI commits
        changes, the preview iframe will load this page at the new branch,
        and its inner (blue) trigger will show the tool's new version live.
      </p>

      <h2>Counter (pick target)</h2>
      <Counter />

      <h2>Roadmap</h2>
      <p>Open issues on <code>MarcusRobbins/chorus</code>:</p>
      <Roadmap />
    </div>
  );
}

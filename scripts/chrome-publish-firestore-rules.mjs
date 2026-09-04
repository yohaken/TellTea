/**
 * Inject TellTea firestore.rules into Firebase Console (Chrome) and click Publish.
 * Requires: Chrome logged into Firebase, Rules tab open.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

const injectJs = `(function(){
  const rulesText = ${JSON.stringify(rules)};
  const ed = document.querySelector('.cm-editor');
  if(!ed) return 'no .cm-editor';
  ed.focus();
  ed.click();
  if(ed.cmView && ed.cmView.view) {
    const v = ed.cmView.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: rulesText } });
    return 'ok cmView len='+rulesText.length;
  }
  document.execCommand('selectAll');
  const chunk = 8000;
  for (let i = 0; i < rulesText.length; i += chunk) {
    document.execCommand('insertText', false, rulesText.slice(i, i + chunk));
  }
  const lines = document.querySelectorAll('.cm-line').length;
  return 'ok chunked len='+rulesText.length+' lines='+lines;
})()`;

writeFileSync("/tmp/inject-rules.js", injectJs);
writeFileSync(
  "/tmp/inject-rules.applescript",
  `tell application "Google Chrome"
  activate
  tell active tab of front window
  execute javascript (read POSIX file "/tmp/inject-rules.js")
  delay 1
  set pubJs to "(function(){
    const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/publish/i.test((x.innerText||x.textContent||'')+(x.getAttribute('aria-label')||'')));
    if(b){ b.scrollIntoView(); b.click(); return 'published'; }
    return 'no publish button';
  })()"
  return execute javascript pubJs
  end tell
end tell`,
);

const out = execSync("osascript /tmp/inject-rules.applescript", {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
console.log(out.trim());

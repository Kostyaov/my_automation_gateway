const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function setup() {
  const sockets = [];
  const context = vm.createContext({
    window: { addEventListener() {}, location: { protocol: "http:", host: "localhost" } },
    WebSocket: class {
      constructor() { sockets.push(this); }
      close() { this.closed = true; }
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontends/web_dlp_app/script.js"), "utf8"), context);
  vm.runInContext(`
    const logs = [];
    let status = "";
    let state = "";
    nodes = { startJob: {}, updateYtdlp: {}, cancelJob: {} };
    appendConsole = (text) => logs.push(text);
    clearConsole = () => { logs.length = 0; };
    setFormStatus = (text) => { status = text; };
    setJobState = (text) => { state = text; };
    updateOperationView = () => {};
    loadConfig = () => {};
  `, context);
  return { sockets, run: (code) => vm.runInContext(code, context) };
}

for (const type of ["finished", "error", "cancelled"]) {
  test(type + " closes console and ignores late transport errors", () => {
    const { sockets, run } = setup();
    run('connectJobSocket("one")');
    const socket = sockets[0];
    const lateError = socket.onerror;
    socket.onmessage({ data: JSON.stringify({ type, data: { message: "Result" } }) });
    const before = run("status");
    lateError();
    assert.equal(socket.closed, true);
    assert.equal(socket.onerror, null);
    assert.equal(run("status"), before);
    assert.equal(run('logs.some(line => line.includes("Console connection failed"))'), false);
  });
}

test("previous socket cannot change next job", () => {
  const { sockets, run } = setup();
  run('connectJobSocket("one")');
  const oldError = sockets[0].onerror;
  const oldMessage = sockets[0].onmessage;
  run('prepareJobUi("Preparing"); connectJobSocket("two")');
  oldError();
  oldMessage({ data: JSON.stringify({ type: "finished", data: { message: "Old result" } }) });
  assert.equal(run("status"), "Preparing");
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets[1].closed, undefined);
});

test("active connection errors remain visible", () => {
  const { sockets, run } = setup();
  run('connectJobSocket("one")');
  sockets[0].onerror();
  assert.equal(run("status"), "Console connection failed.");
});

import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const {GITHUB_REPO, GITHUB_TOKEN, GITHUB_BRANCH = 'main', PAGES_ORIGIN, PORT = 8787} = process.env;
if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPO ?? '') || !GITHUB_TOKEN || !PAGES_ORIGIN) {
  throw Error('Set GITHUB_REPO, GITHUB_TOKEN and PAGES_ORIGIN.');
}

const endpoint = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/shared-learning.json';
const githubHeaders = {
  Authorization: 'Bearer ' + GITHUB_TOKEN,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json'
};
const learningSource = readFileSync(new URL('../source/scripts/learning.js', import.meta.url), 'utf8');
const maxBytes = 1024 * 1024;

function validate(snapshot) {
  const raw = JSON.parse(snapshot, (key, value) => {
    if (['__proto__','constructor','prototype'].includes(key) || /[<>&]/.test(key) ||
        (typeof value === 'string' && /[<>&]/.test(value))) throw Error('Invalid learning field.');
    return value;
  });
  if (raw?.brains?.length !== 20) throw Error('Expected 20 brains.');
  for (const brain of raw.brains) {
    for (const key of ['games','kills','deaths','survivals','wins','totalSurvival','damageDealt','damageTaken']) {
      if (!Number.isFinite(brain?.[key]) || brain[key] < 0) throw Error('Invalid brain statistic.');
    }
    for (const values of Object.values(brain.q ?? {})) {
      if (Object.keys(values).some(key => !['rush','strafe','flank','retreat','hold'].includes(key))) {
        throw Error('Invalid action.');
      }
    }
  }
  const context = {window:{}};
  runInNewContext(learningSource, context);
  context.window.LSLearning.importData(raw);
}

async function readGitHub() {
  const url = new URL(endpoint);
  url.searchParams.set('ref', GITHUB_BRANCH);
  const response = await fetch(url, {headers:githubHeaders, signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error('GitHub read failed: ' + response.status);
  return response.json();
}

async function saveGitHub(snapshot) {
  const content = Buffer.from(snapshot).toString('base64');
  for (let attempt = 0; attempt < 3; attempt++) {
    const {sha} = await readGitHub();
    const response = await fetch(endpoint, {
      method:'PUT', headers:githubHeaders, signal:AbortSignal.timeout(8000),
      body:JSON.stringify({message:'Update LAST SIGNAL shared learning', content, sha, branch:GITHUB_BRANCH})
    });
    if (response.ok) return;
    if (response.status !== 409) throw Error('GitHub write failed: ' + response.status);
  }
  throw Error('Concurrent GitHub writes exceeded retry limit.');
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

let writes = Promise.resolve();
createServer(async (request, response) => {
  const send = (code, body = '') => {
    response.writeHead(code, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    response.end(body);
  };
  if (request.url !== '/learning') return send(404);
  const origin = request.headers.origin;
  if (origin && origin !== PAGES_ORIGIN) return send(403);
  response.setHeader('Access-Control-Allow-Origin', PAGES_ORIGIN);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Vary', 'Origin');
  if (request.method === 'OPTIONS') return send(204);
  try {
    if (request.method === 'GET') {
      const file = await readGitHub();
      return send(200, Buffer.from(file.content, 'base64'));
    }
    if (request.method !== 'POST') return send(405);
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(415);
    const snapshot = await readBody(request);
    if (snapshot === null) return send(413);
    try { validate(snapshot); } catch { return send(400, '{"error":"Invalid learning data"}'); }
    const job = writes.then(() => saveGitHub(snapshot));
    writes = job.catch(() => {});
    await job;
    return send(204);
  } catch (error) {
    console.error(error.message);
    return send(502, '{"error":"Shared save unavailable"}');
  }
}).listen(Number(PORT), '0.0.0.0');

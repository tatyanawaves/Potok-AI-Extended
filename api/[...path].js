import { handleNodeRequest } from "../scripts/codex-proxy.mjs";

export default async function handler(req, res) {
  await handleNodeRequest(req, res);
}

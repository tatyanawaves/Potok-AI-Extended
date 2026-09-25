/**
 * The worker's entry point: the HTTP handler from ./index plus the Workflow
 * class Cloudflare instantiates for server tasks. Separate from ./index so the
 * handler stays importable in Node tests, where `cloudflare:workers` is absent.
 */
import worker from './index';

export { AgentTaskWorkflow } from './agentWorkflow';
export default worker;

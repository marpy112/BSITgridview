import { handleVercelRequest } from '../server/vercel-api.js';

export default { fetch(request) { return handleVercelRequest(request); } };

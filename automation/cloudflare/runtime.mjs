import { GitHubArchive } from '../archive-github.mjs';
import { OpenAIResearcher } from '../openai.mjs';
import { ResendMailer } from '../mail.mjs';
import { HonkyTonkRunner } from '../runner.mjs';
import { CloudflareRenderer } from './render.mjs';

export async function cloudflareRuntime(env, options = {}) {
  const archive = new GitHubArchive({ repository: env.HONKYTONK_DATA_REPOSITORY, branch: env.HONKYTONK_DATA_BRANCH || 'main', token: env.HONKYTONK_GITHUB_TOKEN, cacheLimit: 8 * 1024 * 1024 });
  await archive.init();
  const runner = new HonkyTonkRunner({ archive, researcher: new OpenAIResearcher({ apiKey: env.OPENAI_API_KEY }), renderer: new CloudflareRenderer(env), mailer: new ResendMailer({ apiKey: env.RESEND_API_KEY, from: env.HONKYTONK_MAIL_FROM }), autoDispatch: false, ...options });
  return { archive, runner };
}

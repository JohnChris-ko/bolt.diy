import { dockerRuntime } from '~/lib/docker';

// This is a bit of a hack to make the types work.
// The original webcontainer was a Promise<WebContainer>.
// Our new dockerRuntime has a similar API, but is not a WebContainer.
// We cast it to `any` to avoid having to refactor all the types in the app at once.
export let webcontainer: Promise<any> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer = dockerRuntime.boot();
}

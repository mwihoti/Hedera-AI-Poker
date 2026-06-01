declare module '@hashgraph/hedera-agent-kit/plugins' {
  import type { Plugin } from '@hashgraph/hedera-agent-kit';

  export const coreAccountPlugin: Plugin;
  export const coreTokenPlugin: Plugin;
  export const coreTokenQueryPlugin: Plugin;
}

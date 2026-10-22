import { fileURLToPath } from 'node:url';
import { defineMain } from '@storybook/react-vite/node';

const resolveLocal = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const dataServicesMock = resolveLocal('./mocks/dataServices.ts');
const storyHooksMock = resolveLocal('./mocks/storyHooks.ts');
const performanceMock = resolveLocal('./mocks/performance.ts');
const tauriMock = resolveLocal('./mocks/tauri.ts');

const storyAliases = [
  { find: '@/contexts/FeedContext', replacement: resolveLocal('./mocks/feedContext.tsx') },
  { find: '@/contexts/ThemeContext', replacement: resolveLocal('./mocks/themeContext.tsx') },
  // Exact match: settings submodules (pure helpers) load the real files.
  { find: /^@\/services\/settings$/, replacement: dataServicesMock },
  { find: '@/services/storage/storageFactory', replacement: dataServicesMock },
  { find: '@/services/feeds/feedMetadataCache', replacement: dataServicesMock },
  { find: '@/services/feeds/feedsManager', replacement: dataServicesMock },
  { find: '@/services/feeds/feedsFetcher', replacement: dataServicesMock },
  { find: '@/services/feeds/feedRefreshPipeline', replacement: dataServicesMock },
  { find: '@/services/feeds/libraryOrderPersist', replacement: dataServicesMock },
  { find: '@/services/feeds/opmlWorkflowService', replacement: dataServicesMock },
  { find: '@/services/feeds/opmlUiWorkflow', replacement: dataServicesMock },
  { find: '@/services/tags/tagsManager', replacement: dataServicesMock },
  { find: '@/stores/articleStore', replacement: dataServicesMock },
  { find: '@/services/articles/articlesManager', replacement: dataServicesMock },
  { find: '@/services/articles/articleContentProcessingService', replacement: dataServicesMock },
  { find: '@/services/articles/readerModeService', replacement: dataServicesMock },
  { find: '@/services/articles/postlightParserService', replacement: dataServicesMock },
  { find: '@/services/saved/savedArticlesService', replacement: dataServicesMock },
  { find: '@/services/favicons/faviconFetcher', replacement: dataServicesMock },
  { find: '@/services/logger', replacement: dataServicesMock },
  { find: '@/services/ui/appToastService', replacement: dataServicesMock },
  { find: '@/services/ui/feedLibraryMutationBus', replacement: dataServicesMock },
  { find: '@/services/ui/openSettingsWindow', replacement: dataServicesMock },
  { find: '@/services/diagnostics/webKitAttribution', replacement: dataServicesMock },
  { find: '@/hooks/useFeedLibraryMutation', replacement: storyHooksMock },
  { find: '@/hooks/useFeedRefreshActivity', replacement: storyHooksMock },
  { find: '@/hooks/useUserMessageChannel', replacement: storyHooksMock },
  { find: '@/hooks/useAppUpdatePrompt', replacement: storyHooksMock },
  { find: '@/services/performance/interactionPerformance', replacement: performanceMock },
  { find: '@/services/performance/sidebarSwitchTrace', replacement: performanceMock },
  { find: '@tauri-apps/api/window', replacement: tauriMock },
  { find: '@tauri-apps/api/core', replacement: tauriMock },
  { find: '@tauri-apps/api/event', replacement: tauriMock },
];

export default defineMain({
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  staticDirs: ['../public'],
  typescript: {
    reactDocgen: false,
  },
  viteFinal: async (config) => {
    const configuredAliases = config.resolve?.alias ?? [];
    const existingAliases = Array.isArray(configuredAliases)
      ? configuredAliases
      : Object.entries(configuredAliases).map(([find, replacement]) => ({ find, replacement }));

    config.resolve = {
      ...config.resolve,
      alias: [
        ...storyAliases,
        ...existingAliases,
        { find: '@', replacement: resolveLocal('../src') },
      ],
    };
    config.server = {
      ...config.server,
      host: false,
      strictPort: false,
      hmr: undefined,
      watch: {
        ...config.server?.watch,
        // Same as vite.config.ts: Rust build output (thousands of files) must not trigger page reloads.
        ignored: ['**/src-tauri/**'],
      },
    };

    return config;
  },
});


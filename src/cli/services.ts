import { Paths } from "../util/Paths.js";
import { Logger } from "../util/Logger.js";
import { RepoLocator } from "../core/RepoLocator.js";
import { ScopeResolver } from "../core/ScopeResolver.js";
import { ModuleStore } from "../core/ModuleStore.js";
import { ModuleResolver } from "../core/ModuleResolver.js";
import { CompositionResolver } from "../core/CompositionResolver.js";
import { MarketplaceRegistry } from "../core/MarketplaceRegistry.js";
import { KnownMarketplacesCache } from "../core/KnownMarketplacesCache.js";
import { InstalledPluginsCache } from "../core/InstalledPluginsCache.js";
import { MarketplaceCacheInstaller } from "../core/MarketplaceCacheInstaller.js";
import { PluginCacheInstaller } from "../core/PluginCacheInstaller.js";
import { ModuleUpdater } from "../core/ModuleUpdater.js";
import { SettingsRepository } from "../core/SettingsRepository.js";
import { SettingsApplier } from "../core/SettingsApplier.js";
import { ModuleListFile } from "../core/ModuleListFile.js";
import { ApplyModulesUseCase } from "../core/ApplyModulesUseCase.js";
import { DisableModulesUseCase } from "../core/DisableModulesUseCase.js";
import { EnabledPluginsReporter } from "../core/EnabledPluginsReporter.js";
import { ModuleDriftReporter } from "../core/ModuleDriftReporter.js";
import { EnabledPluginsVerifier } from "../core/EnabledPluginsVerifier.js";
import { ModuleArchiver } from "../core/ModuleArchiver.js";

export interface CliServices {
  paths: Paths;
  repoLocator: RepoLocator;
  scopeResolver: ScopeResolver;
  moduleStore: ModuleStore;
  compositionResolver: CompositionResolver;
  moduleResolver: ModuleResolver;
  moduleArchiver: ModuleArchiver;
  marketplaceRegistry: MarketplaceRegistry;
  knownMarketplacesCache: KnownMarketplacesCache;
  installedPluginsCache: InstalledPluginsCache;
  marketplaceCacheInstaller: MarketplaceCacheInstaller;
  pluginCacheInstaller: PluginCacheInstaller;
  moduleUpdater: ModuleUpdater;
  settingsRepository: SettingsRepository;
  settingsApplier: SettingsApplier;
  moduleListFile: ModuleListFile;
  enabledPluginsReporter: EnabledPluginsReporter;
  moduleDriftReporter: ModuleDriftReporter;
  enabledPluginsVerifier: EnabledPluginsVerifier;
  applyModulesUseCase: ApplyModulesUseCase;
  disableModulesUseCase: DisableModulesUseCase;
}

/** Constructs the full dependency graph `Cli.buildCommand` dispatches against — kept separate from
 * argv parsing/dispatch so the two concerns (what a command needs vs. which command to run) can be
 * read and changed independently. */
export function buildServices(env: NodeJS.ProcessEnv, logger: Logger): CliServices {
  const paths = new Paths(env);
  const repoLocator = new RepoLocator();
  const scopeResolver = new ScopeResolver(repoLocator, paths, logger);
  const moduleStore = new ModuleStore(paths);
  const compositionResolver = new CompositionResolver(moduleStore);
  const moduleResolver = new ModuleResolver(compositionResolver, logger);
  const moduleArchiver = new ModuleArchiver(paths, moduleStore, compositionResolver, logger);
  const marketplaceRegistry = new MarketplaceRegistry(paths);
  const knownMarketplacesCache = new KnownMarketplacesCache(paths);
  const installedPluginsCache = new InstalledPluginsCache(paths);
  const marketplaceCacheInstaller = new MarketplaceCacheInstaller(knownMarketplacesCache, logger, env);
  const pluginCacheInstaller = new PluginCacheInstaller(knownMarketplacesCache, installedPluginsCache, logger, env);
  const moduleUpdater = new ModuleUpdater(logger, env);
  const settingsRepository = new SettingsRepository();
  const settingsApplier = new SettingsApplier(logger);
  const moduleListFile = new ModuleListFile(paths, repoLocator);
  const enabledPluginsReporter = new EnabledPluginsReporter(scopeResolver, settingsRepository, installedPluginsCache, logger);
  const moduleDriftReporter = new ModuleDriftReporter(moduleListFile, moduleResolver, logger);
  const enabledPluginsVerifier = new EnabledPluginsVerifier(logger, env);
  const applyModulesUseCase = new ApplyModulesUseCase(
    scopeResolver,
    moduleResolver,
    settingsRepository,
    settingsApplier,
    marketplaceCacheInstaller,
    pluginCacheInstaller,
    enabledPluginsReporter,
    logger
  );
  const disableModulesUseCase = new DisableModulesUseCase(
    scopeResolver,
    moduleResolver,
    settingsRepository,
    settingsApplier,
    enabledPluginsReporter,
    logger
  );

  return {
    paths,
    repoLocator,
    scopeResolver,
    moduleStore,
    compositionResolver,
    moduleResolver,
    moduleArchiver,
    marketplaceRegistry,
    knownMarketplacesCache,
    installedPluginsCache,
    marketplaceCacheInstaller,
    pluginCacheInstaller,
    moduleUpdater,
    settingsRepository,
    settingsApplier,
    moduleListFile,
    enabledPluginsReporter,
    moduleDriftReporter,
    enabledPluginsVerifier,
    applyModulesUseCase,
    disableModulesUseCase,
  };
}

import type { Config } from '../config.ts';
import { RepoManager } from '../projects/repos.ts';
import { SecretStore } from '../projects/secrets.ts';
import { ProjectStore } from '../projects/store.ts';
import { ProjectsWorkflow } from '../projects/workflow.ts';
import { ErrorsWorkflow } from './errors/workflow.ts';
import { ResolverWorkflow } from './resolver/workflow.ts';
import type { Workflow } from './types.ts';

export interface LoadedWorkflows {
  workflows: Workflow[];
  /** The project database every workflow reads. Close it on shutdown. */
  projects: ProjectStore;
  /** The managed clones of each project's repository. */
  repos: RepoManager;
}

/**
 * The one place workflows are switched on. Projects is always there: it is where a repo is added, and
 * the other tabs have nothing to show until one is. Errors and the resolver each have their own switch.
 *
 * Order matters: the resolver reads the errors workflow's store, so errors is built first and
 * handed over. A resolver without errors is allowed: it just has nothing to poll.
 */
export function loadWorkflows(config: Config): LoadedWorkflows {
  const projects = new ProjectStore(config.projectsDb, new SecretStore(config.secretKeyFile));
  // One clone of each project's repository, made when the project is added and shared with the resolver.
  const repos = new RepoManager({ dir: config.reposDir, remoteUrl: (repo) => config.githubCloneUrl.replaceAll('{repo}', repo) });

  const workflows: Workflow[] = [
    new ProjectsWorkflow({
      projects,
      repos,
      githubApiUrl: config.errors?.github.apiUrl ?? config.resolver?.githubApiUrl ?? 'https://api.github.com',
      ingest: config.errors ? { host: config.errors.ingestHost, port: config.errors.ingestPort, dsnKey: config.errors.dsnPublicKey } : null,
    }),
  ];
  const errors = config.errors ? new ErrorsWorkflow(config.errors, projects) : null;
  if (errors) workflows.push(errors);
  if (config.resolver) workflows.push(new ResolverWorkflow(config.resolver, errors?.store ?? null, projects, { repos }));

  return { workflows, projects, repos };
}

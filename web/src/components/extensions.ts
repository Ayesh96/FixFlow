import type { ComponentType } from 'react';
import { ErrorsPanel } from '@/components/errors/ErrorsPanel';
import { ProjectsPanel } from '@/components/projects/ProjectsPanel';
import { ResolverPanel } from '@/components/resolver/ResolverPanel';

/** The UI for each server workflow, keyed by its id. A workflow without an entry here gets no tab. */
export const PANELS: Record<string, ComponentType> = {
  projects: ProjectsPanel,
  errors: ErrorsPanel,
  resolver: ResolverPanel,
};

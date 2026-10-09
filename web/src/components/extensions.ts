import type { ComponentType } from 'react';
import { ProjectsPanel } from '@/components/projects/ProjectsPanel';

/** The UI for each server workflow, keyed by its id. A workflow without an entry here gets no tab.
 *  Errors and the resolver show inside each project's card, so only Projects has a tab. */
export const PANELS: Record<string, ComponentType> = {
  projects: ProjectsPanel,
};

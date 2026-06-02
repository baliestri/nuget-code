export interface WorkspaceTarget {
  id: string;
  kind: "solution" | "project";
  name: string;
  path: string;
  projectPaths: string[];
}

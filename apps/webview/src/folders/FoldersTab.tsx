import type { ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { SideBar } from "../app/SideBar";

export function FoldersTab(): ReactNode {
  return (
    <>
      <SideBar />
      <Placeholder title="Folders" />
    </>
  );
}

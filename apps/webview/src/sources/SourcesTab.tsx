import type { ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { SideBar } from "../app/SideBar";

export function SourcesTab(): ReactNode {
  return (
    <>
      <SideBar />
      <Placeholder title="Sources" />
    </>
  );
}

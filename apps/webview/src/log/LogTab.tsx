import type { ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { SideBar } from "../app/SideBar";

export function LogTab(): ReactNode {
  return (
    <>
      <SideBar />
      <Placeholder title="Log" />
    </>
  );
}

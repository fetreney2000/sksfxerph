// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/rph/status-badge";

afterEach(cleanup);

describe("StatusBadge — the teacher's words, not the reviewer's grade", () => {
  it("shows Disahkan for an approved plan even when the grade is 1", () => {
    render(<StatusBadge status="approved" grade={1} />);

    expect(screen.getByText("Disahkan")).toBeTruthy();
    expect(screen.queryByText(/Lengkap \(1\)/)).toBeNull();
  });
});

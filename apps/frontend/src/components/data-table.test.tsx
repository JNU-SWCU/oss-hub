import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, type DataTableColumn } from "./data-table";

interface Applicant {
  id: string;
  name: string;
  status: string;
}

const columns: DataTableColumn<Applicant>[] = [
  { id: "name", header: "이름", cell: (row) => row.name },
  { id: "status", header: "상태", cell: (row) => row.status },
];

const rows: Applicant[] = [{ id: "1", name: "홍길동", status: "대기" }];

describe("DataTable", () => {
  it("renders injected columns and rows", () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />,
    );

    expect(html).toContain("이름");
    expect(html).toContain("홍길동");
    expect(html).toContain("대기");
  });

  it("renders the empty state slot when data is empty", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={[]}
        rowKey={(row) => row.id}
        emptyState="신청자가 없습니다."
      />,
    );

    expect(html).toContain("신청자가 없습니다.");
  });

  it("renders the loading slot when isLoading is true", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        isLoading
        loadingSlot="불러오는 중입니다."
      />,
    );

    expect(html).toContain("불러오는 중입니다.");
    expect(html).not.toContain("홍길동");
  });
});

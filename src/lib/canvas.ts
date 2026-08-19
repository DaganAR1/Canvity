// Minimal Canvas LMS REST API client.
// Docs: https://canvas.instructure.com/doc/api/

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state: string;
}

export interface CanvasAssignmentGroup {
  id: number;
  name: string;
  group_weight: number | null;
}

export interface CanvasSubmission {
  submitted_at: string | null;
  workflow_state: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description: string | null;
  html_url: string;
  due_at: string | null;
  points_possible: number | null;
  assignment_group_id: number;
  submission?: CanvasSubmission | null;
  has_submitted_submissions?: boolean;
}

export class CanvasApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "CanvasApiError";
  }
}

export function normalizeCanvasDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/\/+$/, "");
  domain = domain.split("/")[0];
  return domain;
}

export class CanvasClient {
  private baseUrl: string;

  constructor(domain: string, private token: string) {
    this.baseUrl = `https://${normalizeCanvasDomain(domain)}/api/v1`;
  }

  private async request<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          for (const v of value) url.searchParams.append(key, v);
        } else {
          url.searchParams.set(key, value);
        }
      }
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new CanvasApiError("Canvas rejected the API token (401 Unauthorized)", 401);
      }
      throw new CanvasApiError(`Canvas API request failed: ${res.status} ${res.statusText}`, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async requestPaginated<T>(path: string, params?: Record<string, string | string[]>): Promise<T[]> {
    const results: T[] = [];
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          for (const v of value) url.searchParams.append(key, v);
        } else {
          url.searchParams.set(key, value);
        }
      }
    }
    url.searchParams.set("per_page", "100");

    let next: string | null = url.toString();
    let pages = 0;
    while (next && pages < 50) {
      const res = await fetch(next, {
        headers: { Authorization: `Bearer ${this.token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) {
          throw new CanvasApiError("Canvas rejected the API token (401 Unauthorized)", 401);
        }
        throw new CanvasApiError(`Canvas API request failed: ${res.status} ${res.statusText}`, res.status);
      }
      const batch = (await res.json()) as T[];
      results.push(...batch);

      const linkHeader = res.headers.get("Link");
      next = parseNextLink(linkHeader);
      pages++;
    }
    return results;
  }

  /** Verifies the token/domain are valid by calling /users/self */
  async validateCredentials(): Promise<{ name: string }> {
    return this.request<{ name: string }>("/users/self");
  }

  async getActiveCourses(): Promise<CanvasCourse[]> {
    const courses = await this.requestPaginated<CanvasCourse>("/courses", {
      enrollment_state: "active",
      "state[]": ["available"],
    });
    return courses.filter((c) => c.workflow_state === "available" && c.name);
  }

  async getAssignmentGroups(courseId: number): Promise<CanvasAssignmentGroup[]> {
    return this.requestPaginated<CanvasAssignmentGroup>(`/courses/${courseId}/assignment_groups`);
  }

  async getAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.requestPaginated<CanvasAssignment>(`/courses/${courseId}/assignments`, {
      order_by: "due_at",
      "include[]": ["submission"],
    });
  }
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") {
      return match[1];
    }
  }
  return null;
}

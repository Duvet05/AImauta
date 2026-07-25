import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  student: {
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn()
  },
  course: {
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn()
  },
  grade: {
    findUnique: vi.fn()
  }
}));

vi.mock("@/lib/prisma", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/prisma")>();
  return { ...original, prisma: prismaMock };
});

import { GET as getCourses } from "@/app/api/courses/route";
import { PATCH as patchCourse } from "@/app/api/courses/[id]/route";
import { GET as getGrade } from "@/app/api/grades/[id]/route";
import { GET as getStudents } from "@/app/api/students/route";
import { PATCH as patchStudent } from "@/app/api/students/[id]/route";

function patchRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://aimauta.test${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("school directory Enrollment contract", () => {
  it("filters students through enrollments while preserving the courses response", async () => {
    prismaMock.$transaction.mockResolvedValue([
      [
        {
          id: "student-1",
          firstName: "Ada",
          lastName: "Lovelace",
          enrollments: [{ course: { id: "course-1", name: "Álgebra" } }]
        }
      ],
      1
    ]);

    const response = await getStudents(
      new Request(
        "http://aimauta.test/api/students?courseId=course-1&gradeId=grade-1&levelId=level-1"
      )
    );

    expect(prismaMock.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enrollments: {
            some: {
              course: {
                id: "course-1",
                gradeId: "grade-1",
                grade: { levelId: "level-1" }
              }
            }
          }
        },
        include: {
          enrollments: {
            include: {
              course: {
                include: { grade: { include: { level: true } } }
              }
            }
          }
        }
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: "student-1",
          courses: [{ id: "course-1", name: "Álgebra" }]
        }
      ],
      pagination: { total: 1 }
    });
  });

  it("updates student courses without replacing retained enrollment rows", async () => {
    prismaMock.student.update.mockResolvedValue({
      id: "student-1",
      enrollments: [
        { course: { id: "course-1" } },
        { course: { id: "course-2" } }
      ]
    });

    const response = await patchStudent(
      patchRequest("/api/students/student-1", {
        courseIds: ["course-1", "course-1", "course-2"]
      }),
      { params: Promise.resolve({ id: "student-1" }) }
    );

    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: "student-1" },
      data: {
        enrollments: {
          deleteMany: {
            courseId: { notIn: ["course-1", "course-2"] }
          },
          connectOrCreate: [
            {
              where: {
                studentId_courseId: {
                  studentId: "student-1",
                  courseId: "course-1"
                }
              },
              create: { course: { connect: { id: "course-1" } } }
            },
            {
              where: {
                studentId_courseId: {
                  studentId: "student-1",
                  courseId: "course-2"
                }
              },
              create: { course: { connect: { id: "course-2" } } }
            }
          ]
        }
      },
      include: {
        enrollments: { include: { course: true } }
      }
    });
    await expect(response.json()).resolves.toEqual({
      id: "student-1",
      courses: [{ id: "course-1" }, { id: "course-2" }]
    });
  });

  it("filters courses through enrollments and maps the legacy student count", async () => {
    prismaMock.$transaction.mockResolvedValue([
      [
        {
          id: "course-1",
          name: "Álgebra",
          _count: { enrollments: 3, teachers: 1 }
        }
      ],
      1
    ]);

    const response = await getCourses(
      new Request(
        "http://aimauta.test/api/courses?studentId=student-1&teacherId=teacher-1"
      )
    );

    expect(prismaMock.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enrollments: { some: { studentId: "student-1" } },
          teachers: { some: { id: "teacher-1" } }
        },
        include: {
          grade: { include: { level: true } },
          _count: { select: { enrollments: true, teachers: true } }
        }
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: "course-1",
          _count: { students: 3, teachers: 1 }
        }
      ]
    });
  });

  it("updates course students without replacing retained enrollment rows", async () => {
    prismaMock.course.update.mockResolvedValue({
      id: "course-1",
      enrollments: [
        { student: { id: "student-1" } },
        { student: { id: "student-2" } }
      ],
      teachers: []
    });

    const response = await patchCourse(
      patchRequest("/api/courses/course-1", {
        studentIds: ["student-1", "student-2", "student-2"]
      }),
      { params: Promise.resolve({ id: "course-1" }) }
    );

    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: {
        enrollments: {
          deleteMany: {
            studentId: { notIn: ["student-1", "student-2"] }
          },
          connectOrCreate: [
            {
              where: {
                studentId_courseId: {
                  studentId: "student-1",
                  courseId: "course-1"
                }
              },
              create: { student: { connect: { id: "student-1" } } }
            },
            {
              where: {
                studentId_courseId: {
                  studentId: "student-2",
                  courseId: "course-1"
                }
              },
              create: { student: { connect: { id: "student-2" } } }
            }
          ]
        }
      },
      include: {
        grade: { include: { level: true } },
        enrollments: { include: { student: true } },
        teachers: true
      }
    });
    await expect(response.json()).resolves.toEqual({
      id: "course-1",
      students: [{ id: "student-1" }, { id: "student-2" }],
      teachers: []
    });
  });

  it("uses enrollment counts inside a grade and exposes student counts", async () => {
    prismaMock.grade.findUnique.mockResolvedValue({
      id: "grade-1",
      name: "Primero",
      courses: [
        {
          id: "course-1",
          name: "Álgebra",
          _count: { enrollments: 4, teachers: 2 }
        }
      ]
    });

    const response = await getGrade(new Request("http://aimauta.test"), {
      params: Promise.resolve({ id: "grade-1" })
    });

    expect(prismaMock.grade.findUnique).toHaveBeenCalledWith({
      where: { id: "grade-1" },
      include: {
        level: true,
        courses: {
          orderBy: { name: "asc" },
          include: {
            _count: { select: { enrollments: true, teachers: true } }
          }
        }
      }
    });
    await expect(response.json()).resolves.toEqual({
      id: "grade-1",
      name: "Primero",
      courses: [
        {
          id: "course-1",
          name: "Álgebra",
          _count: { students: 4, teachers: 2 }
        }
      ]
    });
  });
});

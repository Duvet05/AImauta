type StudentEnrollment<TCourse> = {
  course: TCourse;
};

type CourseEnrollment<TStudent> = {
  student: TStudent;
};

/**
 * The explicit Enrollment model is an internal persistence detail. Keep the
 * original school-directory response contract stable for API consumers.
 */
export function presentStudentWithCourses<
  TCourse,
  TStudent extends { enrollments: readonly StudentEnrollment<TCourse>[] },
>(student: TStudent) {
  const { enrollments, ...fields } = student;
  return {
    ...fields,
    courses: enrollments.map((enrollment) => enrollment.course),
  };
}

export function presentCourseWithStudents<
  TStudent,
  TCourse extends { enrollments: readonly CourseEnrollment<TStudent>[] },
>(course: TCourse) {
  const { enrollments, ...fields } = course;
  return {
    ...fields,
    students: enrollments.map((enrollment) => enrollment.student),
  };
}

export function presentCourseWithStudentCount<
  TCourse extends { _count: { enrollments: number } },
>(course: TCourse) {
  const { _count, ...fields } = course;
  const { enrollments, ...counts } = _count;
  return {
    ...fields,
    _count: {
      ...counts,
      students: enrollments,
    },
  };
}

export function uniqueRelationIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500;
    let message = "Не удалось выполнить запрос. Попробуйте ещё раз.";
    if (error instanceof ZodError) {
      status = 400;
      message = "Проверьте введённые данные и ограничения полей.";
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = status === 404 ? "Ресурс не найден." : error.message;
    } else if (
      error instanceof Error &&
      "status" in error &&
      [400, 413].includes(Number(error.status))
    ) {
      status = Number(error.status);
      message =
        status === 413 ? "Запрос слишком большой." : "Некорректный JSON.";
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      status = 409;
      message = "Такая запись уже существует.";
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      status = 404;
      message = "Запись не найдена.";
    }
    if (status === 500)
      console.error(
        "request_failed",
        error instanceof Error ? error.constructor.name : "UnknownError",
      );
    host.switchToHttp().getResponse().status(status).json({ message });
  }
}

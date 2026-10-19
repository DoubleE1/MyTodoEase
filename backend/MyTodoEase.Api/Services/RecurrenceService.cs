using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Services;

public static class RecurrenceService
{
    /// <summary>
    /// Next occurrence after completing a recurring task.
    /// Steps forward from the current due date until the result is after today,
    /// so an overdue "every day" task completed today lands on tomorrow, not on a date in the past.
    /// </summary>
    public static DateOnly Next(DateOnly due, Recurrence recurrence, DateOnly today)
    {
        var next = Step(due, recurrence);
        while (next <= today)
        {
            next = Step(next, recurrence);
        }
        return next;
    }

    private static DateOnly Step(DateOnly date, Recurrence recurrence) => recurrence switch
    {
        Recurrence.Daily => date.AddDays(1),
        Recurrence.Weekdays => NextWeekday(date),
        Recurrence.Weekly => date.AddDays(7),
        Recurrence.Biweekly => date.AddDays(14),
        Recurrence.Monthly => date.AddMonths(1),
        Recurrence.Yearly => date.AddYears(1),
        _ => date.AddDays(1),
    };

    private static DateOnly NextWeekday(DateOnly date)
    {
        var next = date.AddDays(1);
        while (next.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
        {
            next = next.AddDays(1);
        }
        return next;
    }
}

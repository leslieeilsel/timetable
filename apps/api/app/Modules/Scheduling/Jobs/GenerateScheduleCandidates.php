<?php

namespace App\Modules\Scheduling\Jobs;

use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Services\AutoScheduler;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Throwable;

class GenerateScheduleCandidates implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 300;

    /** @var list<int> */
    public array $backoff = [10, 30, 60];

    public function __construct(public readonly int $scheduleRunId)
    {
        $this->onConnection('database');
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [
            (new WithoutOverlapping("schedule-run:{$this->scheduleRunId}"))
                ->dontRelease()
                ->expireAfter(330),
        ];
    }

    public function handle(AutoScheduler $scheduler): void
    {
        $run = ScheduleRun::query()->find($this->scheduleRunId);
        if ($run !== null) {
            $scheduler->generate($run);
        }
    }

    public function failed(?Throwable $exception): void
    {
        $run = ScheduleRun::query()->find($this->scheduleRunId);
        if ($run !== null) {
            app(AutoScheduler::class)->markRetriesExhausted($run, $exception, $this->tries);
        }
    }
}

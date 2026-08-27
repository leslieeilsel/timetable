<?php

namespace App\Modules\Scheduling\Jobs;

use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Services\AutoScheduler;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class GenerateScheduleCandidates implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct(public readonly int $scheduleRunId) {}

    public function handle(AutoScheduler $scheduler): void
    {
        $run = ScheduleRun::query()->find($this->scheduleRunId);
        if ($run !== null) {
            $scheduler->generate($run);
        }
    }
}

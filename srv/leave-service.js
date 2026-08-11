const cds = require('@sap/cds');
const { message } = require('@sap/cds/lib/log/cds-error');
const { SELECT, UPDATE, INSERT } = require('@sap/cds/lib/ql/cds-ql');


module.exports = cds.service.impl(async function () {

    const {
        Employees,
        LeaveRequests,
        LeaveTypes,
        LeaveBalances,
        Departments,
        Holidays,
        Notifications
    } = this.entities;


    // Helper Function
    async function calculateLeaveDays(fromDate, toDate) {

        let start = new Date(fromDate);
        let end = new Date(toDate);

        let leaveDays = 0;

        // Get all holidays
        const holidays = await SELECT
            .from(Holidays)
            .where({ isActive: true });

        // Convert holiday dates into Set for fast lookup
        const holidayDates = new Set(
            holidays.map(h => new Date(h.holidayDate).toISOString().split("T")[0])
        );

        while (start <= end) {

            const currentDate = start.toISOString().split("T")[0];
            const day = start.getDay();

            const isWeekend = (day === 0 || day === 6);
            const isHoliday = holidayDates.has(currentDate);

            if (!isWeekend && !isHoliday) {
                leaveDays++;
            }

            start.setDate(start.getDate() + 1);
        }

        return leaveDays;
    }


    // Create Leave Balance for Employee
    this.after("CREATE", "Employees", async (data) => {

        const leaveTypes = await SELECT.from(LeaveTypes);

        for (const leaveType of leaveTypes) {

            await INSERT.into(LeaveBalances).entries({
                employee_ID: data.ID,
                leaveType_ID: leaveType.ID,
                totalLeave: leaveType.yearlyAllocation,
                usedLeave: 0,
                remainingLeave: leaveType.yearlyAllocation
            });

        }

    });

    // Holiday Validation
    this.before("CREATE", "Holidays", async (req) => {
        //  Holiday Name Validation
        if (!req.data.HolidayName || req.data.HolidayName.trim() === "") {
            return req.error(400, "Holiday name is required.");
        }

        // Holiday Date Validation
        if (!req.data.holidayDate) {
            return req.error(400, "Holiday date is required.");
        }

        // Check Duplicate Holiday Name
        const holidayByName = await SELECT.one
            .from(Holidays)
            .where({
                HolidayName: req.data.HolidayName
            });

        if (holidayByName) {
            return req.error(400, "Holiday name already exists.");
        }

        // Check Duplicate Holiday Date
        const holidayByDate = await SELECT.one
            .from(Holidays)
            .where({
                holidayDate: req.data.holidayDate
            });

        if (holidayByDate) {
            return req.error(400, "A holiday already exists on this date.");
        }
    });

    // Holiday Update Validation
    this.before("UPDATE", "Holidays", async (req) => {
        // Holiday Name Required
        if (req.data.HolidayName !== undefined &&
            req.data.HolidayName.trim() === "") {
            return req.error(400, "Holiday name cannot be empty.");
        }

        // Duplicate Holiday Name
        if (req.data.HolidayName) {

            const holiday = await SELECT.one
                .from(Holidays)
                .where({
                    HolidayName: req.data.HolidayName
                });
            if (holiday && holiday.ID !== req.data.ID) {
                return req.error(400, "Holiday name already exists.");
            }
        }

        // Duplicate Holiday Date
        if (req.data.holidayDate) {

            const holiday = await SELECT.one
                .from(Holidays)
                .where({
                    holidayDate: req.data.holidayDate
                });

            if (holiday && holiday.ID !== req.data.ID) {
                return req.error(400, "A holiday already exists on this date.");
            }
        }
    });

    // Deactivate Holiday
    this.on("deactivateHoliday", async (req) => {

        const { ID } = req.data;

        const holiday = await SELECT.one
            .from(Holidays)
            .where({ ID });

        if (!holiday) {
            return req.error(404, "Holiday not found.");
        }

        if (!holiday.isActive) {
            return req.error(400, "Holiday is already inactive.");
        }

        await UPDATE(Holidays)
            .set({
                isActive: false
            })
            .where({ ID });

        return "Holiday deactivated successfully.";

    });

    // Activate Holiday
    this.on("activateHoliday", async (req) => {

        const { ID } = req.data;

        const holiday = await SELECT.one
            .from(Holidays)
            .where({ ID });

        if (!holiday) {
            return req.error(404, "Holiday not found.");
        }

        if (holiday.isActive) {
            return req.error(400, "Holiday is already active.");
        }

        await UPDATE(Holidays)
            .set({
                isActive: true
            })
            .where({ ID });

        return "Holiday activated successfully.";

    });

    // Validate Leave Request
    this.before("CREATE", "LeaveRequests", async (req) => {

        req.data.status = "Pending Manager Approval";

        // Date Validation
        const fromDate = new Date(req.data.fromDate);
        const toDate = new Date(req.data.toDate);

        // Normalize time
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(0, 0, 0, 0);

        // Past Date Validation
        if (fromDate < today) {
            return req.error(400, "Cannot apply leave for past dates.");
        }

        if (fromDate > toDate) {
            return req.error(400, "From Date cannot be after To Date");
        }

        // Calculate working days
        const leaveDays = await calculateLeaveDays(
            req.data.fromDate,
            req.data.toDate
        );

        if (leaveDays <= 0) {
            return req.error(400, "Selected dates do not contain any working days.");
        }

        // Check Employee
        const employee = await SELECT.one
            .from(Employees)
            .where({ ID: req.data.employee_ID });

        if (!employee) {
            return req.error(404, "Employee not found");
        }

        // Check Overlapping Leave
        const overlappingLeave = await SELECT.one
            .from(LeaveRequests)
            .where({ employee_ID: req.data.employee_ID })
            .where(`
            status in ('Pending','Approved') 
            and fromDate <= '${req.data.toDate}' 
            and toDate >= '${req.data.fromDate}'
            `);

        if (overlappingLeave) {
            return req.error(400, "Leave request overlaps with an existing leave.");
        }

        // Check Leave Balance Record
        const balance = await SELECT.one
            .from(LeaveBalances)
            .where({
                employee_ID: req.data.employee_ID,
                leaveType_ID: req.data.leaveType_ID
            });

        if (!balance) {
            return req.error(404, "Leave Policy Not Found");
        }

        // Check Remaining Balance
        if (balance.remainingLeave < leaveDays) {
            return req.error(400, "Insufficient Leave Balance");
        }

    });

    // Notification when Leave is Applied
    this.after("CREATE", "LeaveRequests", async (data) => {

        const employee = await SELECT.one
            .from(Employees)
            .where({ ID: data.employee_ID });

        // Return only if employee doesn't exist OR has no manager
        if (!employee || !employee.manager_ID) {
            return;
        }

        await INSERT.into(Notifications).entries({
            recipient_ID: employee.manager_ID,
            title: "New Leave Request",
            message: `${employee.name} has applied for leave from ${data.fromDate} to ${data.toDate}.`,
            type: "LEAVE_APPLIED",
            createdAt: new Date()
        });

    });

    // After READ
    this.after("READ", "LeaveRequests", (data) => {

        if (!Array.isArray(data))
            data = [data];

        data.forEach(item => {

            if (item.status)
                item.status = item.status.toUpperCase();

        });

    });

    // Manager Approve
    this.on("managerApprove", async (req) => {

        const { ID } = req.data;

        // Find Leave Request
        const leave = await SELECT.one
            .from(LeaveRequests)
            .where({ ID });

        if (!leave) {
            return req.error(404, "Leave Request Not Found");
        }

        // Only manager can approve pending manager requests
        if (leave.status !== "Pending Manager Approval") {
            return req.error(400, "Leave is not waiting for manager approval.");
        }

        // Update Status
        await UPDATE(LeaveRequests)
            .set({
                status: "Pending HR Approval"
            })
            .where({ ID });

        // Notify Employee
        await INSERT.into(Notifications).entries({

            recipient_ID: leave.employee_ID,

            title: "Manager Approved",

            message: "Your leave request has been approved by your manager and is waiting for HR approval.",

            type: "MANAGER_APPROVED",

            createdAt: new Date()

        });

        return "Manager approved. Waiting for HR approval.";

    });

    // HR Approve
    this.on("hrApprove", async (req) => {

        const { ID } = req.data;

        // Find Leave Request
        const leave = await SELECT.one
            .from(LeaveRequests)
            .where({ ID });

        if (!leave) {
            return req.error(404, "Leave Request Not Found");
        }

        // Only HR can approve pending HR requests
        if (leave.status !== "Pending HR Approval") {
            return req.error(400, "Leave is not waiting for HR approval.");
        }

        // Get Leave Balance
        const balance = await SELECT.one
            .from(LeaveBalances)
            .where({
                employee_ID: leave.employee_ID,
                leaveType_ID: leave.leaveType_ID
            });

        if (!balance) {
            return req.error(404, "Leave Balance Not Found");
        }

        // Calculate Leave Days
        const leaveDays = await calculateLeaveDays(
            leave.fromDate,
            leave.toDate
        );

        if (balance.remainingLeave < leaveDays) {
            return req.error(400, "Insufficient Leave Balance");
        }

        // Deduct Leave Balance
        await UPDATE(LeaveBalances)
            .set({
                usedLeave: balance.usedLeave + leaveDays,
                remainingLeave: balance.remainingLeave - leaveDays
            })
            .where({ ID: balance.ID });

        // Final Approval
        await UPDATE(LeaveRequests)
            .set({
                status: "Approved"
            })
            .where({ ID });

        // Notify Employee
        await INSERT.into(Notifications).entries({

            recipient_ID: leave.employee_ID,

            title: "Leave Approved",

            message: `Your leave request has been fully approved. ${leaveDays} day(s) have been deducted from your leave balance.`,

            type: "LEAVE_APPROVED",

            createdAt: new Date()

        });

        return `HR approved. ${leaveDays} day(s) deducted.`;

    });

    // Manager Reject
    this.on("managerReject", async (req) => {

        const { ID } = req.data;

        // Find Leave Request
        const leave = await SELECT.one
            .from(LeaveRequests)
            .where({ ID });

        if (!leave) {
            return req.error(404, "Leave Request Not Found");
        }

        // Only Manager can reject pending manager requests
        if (leave.status !== "Pending Manager Approval") {
            return req.error(400, "Leave is not waiting for manager approval.");
        }

        // Update Status
        await UPDATE(LeaveRequests)
            .set({
                status: "Rejected"
            })
            .where({ ID });

        // Notify Employee
        await INSERT.into(Notifications).entries({

            recipient_ID: leave.employee_ID,

            title: "Leave Rejected",

            message: "Your leave request has been rejected by your manager.",

            type: "MANAGER_REJECTED",

            createdAt: new Date()

        });

        return "Manager rejected the leave request.";

    });

    // HR Reject
    this.on("hrReject", async (req) => {

        const { ID } = req.data;

        // Find Leave Request
        const leave = await SELECT.one
            .from(LeaveRequests)
            .where({ ID });

        if (!leave) {
            return req.error(404, "Leave Request Not Found");
        }

        // Only HR can reject pending HR requests
        if (leave.status !== "Pending HR Approval") {
            return req.error(400, "Leave is not waiting for HR approval.");
        }

        // Update Status
        await UPDATE(LeaveRequests)
            .set({
                status: "Rejected"
            })
            .where({ ID });

        // Notify Employee
        await INSERT.into(Notifications).entries({

            recipient_ID: leave.employee_ID,

            title: "Leave Rejected",

            message: "Your leave request has been rejected by HR.",

            type: "HR_REJECTED",

            createdAt: new Date()

        });

        return "HR rejected the leave request.";

    });

    // Withdraw Leave
    this.on("withdrawLeave", async (req) => {

        const { ID } = req.data;

        // Find Leave Request
        const leave = await SELECT.one
            .from(LeaveRequests)
            .where({ ID });

        if (!leave) {
            return req.error(404, "Leave Request Not Found");
        }

        // Already withdrawn
        if (leave.status === "Withdrawn") {
            return req.error(400, "Leave is already withdrawn.");
        }

        // Approved leave cannot be withdrawn
        if (leave.status === "Approved") {
            return req.error(
                400,
                "Approved leave cannot be withdrawn. Please cancel it instead."
            );
        }

        // Rejected leave cannot be withdrawn
        if (leave.status === "Rejected") {
            return req.error(
                400,
                "Rejected leave cannot be withdrawn."
            );
        }

        // Withdraw Leave
        // Withdraw Leave
        await UPDATE(LeaveRequests)
            .set({
                status: "Withdrawn"
            })
            .where({ ID });

        // Get Employee Details
        const employee = await SELECT.one
            .from(Employees)
            .where({ ID: leave.employee_ID });

        // Notify Manager
        if (employee && employee.manager_ID) {

            await INSERT.into(Notifications).entries({
                recipient_ID: employee.manager_ID,
                title: "Leave Withdrawn",
                message: `${employee.name} has withdrawn the leave request.`,
                type: "LEAVE_WITHDRAWN",
                createdAt: new Date()
            });

        }

        return "Leave withdrawn successfully.";
    });

    // Cancel Leave
    this.on("cancelLeave", async (req) => {

        const { ID } = req.data;

        // Find Leave Request
        const leave = await SELECT.one
            .from(LeaveRequests)
            .where({ ID });

        if (!leave) {
            return req.error(404, "Leave Request Not Found");
        }

        // Only approved leave can be cancelled
        if (leave.status === "Pending Manager Approval") {
            return req.error(400, "Pending leave cannot be cancelled. Withdraw it instead.");
        }

        if (leave.status === "Pending HR Approval") {
            return req.error(400, "Pending leave cannot be cancelled. Withdraw it instead.");
        }

        if (leave.status === "Rejected") {
            return req.error(400, "Rejected leave cannot be cancelled.");
        }

        if (leave.status === "Withdrawn") {
            return req.error(400, "Withdrawn leave cannot be cancelled.");
        }

        if (leave.status === "Cancelled") {
            return req.error(400, "Leave is already cancelled.");
        }

        // Get Leave Balance
        const balance = await SELECT.one
            .from(LeaveBalances)
            .where({
                employee_ID: leave.employee_ID,
                leaveType_ID: leave.leaveType_ID
            });

        if (!balance) {
            return req.error(404, "Leave Balance Not Found");
        }

        // Calculate working days
        const leaveDays = await calculateLeaveDays(
            leave.fromDate,
            leave.toDate
        );

        // Restore Leave Balance
        await UPDATE(LeaveBalances)
            .set({
                usedLeave: balance.usedLeave - leaveDays,
                remainingLeave: balance.remainingLeave + leaveDays
            })
            .where({ ID: balance.ID });

        // Update Status
        // Update Status
        await UPDATE(LeaveRequests)
            .set({
                status: "Cancelled"
            })
            .where({ ID });

        // Get Employee Details
        const employee = await SELECT.one
            .from(Employees)
            .where({ ID: leave.employee_ID });

        // Notify Manager
        if (employee && employee.manager_ID) {

            await INSERT.into(Notifications).entries({
                recipient_ID: employee.manager_ID,
                title: "Leave Cancelled",
                message: `${employee.name} has cancelled an approved leave.`,
                type: "LEAVE_CANCELLED",
                createdAt: new Date()
            });

        }

        return `Leave cancelled successfully. ${leaveDays} day(s) restored.`;

    });

    // Leave History
    this.on("leaveHistory", async (req) => {

        const { employeeID } = req.data;

        return await SELECT
            .from(LeaveRequests)
            .where({ employee_ID: employeeID });

    });


    // Remaining Leave
    this.on("remainingLeave", async (req) => {

        const { employeeID, leaveTypeID } = req.data;

        const balance = await SELECT.one
            .from(LeaveBalances)
            .where({
                employee_ID: employeeID,
                leaveType_ID: leaveTypeID
            });

        if (!balance) {
            return req.error(404, "Leave Balance Not Found");
        }

        return balance.remainingLeave;

    });

    // Total Employees
    this.on("totalEmployees", async () => {

        const employees = await SELECT.from(Employees);

        return employees.length;

    });

    //Employee Manger
    this.on("employeesByManager", async (req) => {
        return await SELECT.from(Employees).where({ manager_ID: req.data.managerID })
    });

    // set default status 
    this.before("CREATE", "Employees", async (req) => {
        req.data.status = "Active";

        if (req.data.manager_ID) {
            const manager = await SELECT.one.from(Employees).where({ ID: req.data.manager_ID });

            if (!manager) {
                return req.error(404, "Manager not found")
            }
        }
    });

    // Prevent self-manager assignment
    this.before("UPDATE", "Employees", (req) => {

        if (req.data.manager_ID && req.data.manager_ID === req.data.ID) {
            return req.error(400, "Employee cannot be their own manager");
        }

    });

    // Leave Summary Report
    this.on("leaveSummary", async () => {
        const leaves = await SELECT.from(LeaveRequests);

        const summary = {
            total: leaves.length,
            pendingManager: 0,
            pendingHR: 0,
            approved: 0,
            rejected: 0,
            withdrawn: 0,
            cancelled: 0
        };

        leaves.forEach(leave => {
            switch (leave.status) {

                case "Pending Manager Approval":
                    summary.pendingManager++;
                    break;

                case "Pending HR Approval":
                    summary.pendingHR++;
                    break;

                case "Approved":
                    summary.approved++;
                    break;

                case "Rejected":
                    summary.rejected++;
                    break;

                case "Withdrawn":
                    summary.withdrawn++;
                    break;

                case "Cancelled":
                    summary.cancelled++;
                    break;
            }

        });
        return JSON.stringify(summary);

    });

    // Department-wise Leave Report
    this.on("departmentLeaveReport", async () => {

        const employees = await SELECT
            .from(Employees);

        const leaves = await SELECT
            .from(LeaveRequests);

        const departments = await SELECT
            .from(Departments);

        const report = [];

        for (const department of departments) {

            const departmentEmployees = employees.filter(
                employee =>
                    employee.department_ID === department.ID
            );

            const employeeIds = departmentEmployees.map(
                employee => employee.ID
            );

            const departmentLeaves = leaves.filter(
                leave =>
                    employeeIds.includes(leave.employee_ID)
            );

            report.push({
                department: department.name,
                totalRequests: departmentLeaves.length,
                approved: departmentLeaves.filter(
                    leave => leave.status === "Approved"
                ).length,
                pendingManager: departmentLeaves.filter(
                    leave => leave.status === "Pending Manager Approval"
                ).length,
                pendingHR: departmentLeaves.filter(
                    leave => leave.status === "Pending HR Approval"
                ).length,
                rejected: departmentLeaves.filter(
                    leave => leave.status === "Rejected"
                ).length,
                withdrawn: departmentLeaves.filter(
                    leave => leave.status === "Withdrawn"
                ).length,
                cancelled: departmentLeaves.filter(
                    leave => leave.status === "Cancelled"
                ).length
            });
        }

        return JSON.stringify(report);

    });
    // Leave Type Usage Report
    this.on("leaveTypeUsageReport", async () => {

        const leaveTypes = await SELECT
            .from(LeaveTypes);

        const leaves = await SELECT
            .from(LeaveRequests);

        const report = [];

        for (const leaveType of leaveTypes) {

            const typeLeaves = leaves.filter(
                leave => leave.leaveType_ID === leaveType.ID
            );

            report.push({
                leaveType: leaveType.name,
                totalRequests: typeLeaves.length,

                approved: typeLeaves.filter(
                    leave => leave.status === "Approved"
                ).length,

                pendingManager: typeLeaves.filter(
                    leave => leave.status === "Pending Manager Approval"
                ).length,

                pendingHR: typeLeaves.filter(
                    leave => leave.status === "Pending HR Approval"
                ).length,

                rejected: typeLeaves.filter(
                    leave => leave.status === "Rejected"
                ).length,

                withdrawn: typeLeaves.filter(
                    leave => leave.status === "Withdrawn"
                ).length,

                cancelled: typeLeaves.filter(
                    leave => leave.status === "Cancelled"
                ).length
            });
        }

        return JSON.stringify(report);

    });

    // Monthly Leave Report
    this.on("monthlyLeaveReport", async () => {

        const leaves = await SELECT
            .from(LeaveRequests);

        const monthlyData = {};

        leaves.forEach(leave => {

            if (!leave.fromDate) {
                return;
            }

            const date = new Date(leave.fromDate);

            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");

            const key = `${year}-${month}`;

            if (!monthlyData[key]) {

                monthlyData[key] = {
                    month: key,
                    totalRequests: 0,
                    approved: 0,
                    pendingManager: 0,
                    pendingHR: 0,
                    rejected: 0,
                    withdrawn: 0,
                    cancelled: 0
                };

            }

            monthlyData[key].totalRequests++;

            switch (leave.status) {

                case "Pending Manager Approval":
                    monthlyData[key].pendingManager++;
                    break;

                case "Pending HR Approval":
                    monthlyData[key].pendingHR++;
                    break;

                case "Approved":
                    monthlyData[key].approved++;
                    break;

                case "Rejected":
                    monthlyData[key].rejected++;
                    break;

                case "Withdrawn":
                    monthlyData[key].withdrawn++;
                    break;

                case "Cancelled":
                    monthlyData[key].cancelled++;
                    break;
            }

        });

        const report = Object.values(monthlyData)
            .sort((a, b) => a.month.localeCompare(b.month));

        return JSON.stringify(report);

    });
    // Leave Balance Report
    this.on("leaveBalanceReport", async () => {

        const balances = await SELECT.from(LeaveBalances);
        const employees = await SELECT.from(Employees);
        const leaveTypes = await SELECT.from(LeaveTypes);

        const report = [];

        for (const balance of balances) {

            const employee = employees.find(
                emp => emp.ID === balance.employee_ID
            );

            const leaveType = leaveTypes.find(
                type => type.ID === balance.leaveType_ID
            );

            if (!employee || !leaveType) {
                continue;
            }

            report.push({
                employeeId: employee.employeeId,
                employeeName: employee.name,
                leaveType: leaveType.name,
                totalLeave: balance.totalLeave,
                usedLeave: balance.usedLeave,
                remainingLeave: balance.remainingLeave
            });
        }

        return JSON.stringify(report);

    });

    // Pending Approval Report
    this.on("pendingApprovalReport", async () => {

        const leaves = await SELECT.from(LeaveRequests);
        const employees = await SELECT.from(Employees);
        const leaveTypes = await SELECT.from(LeaveTypes);

        const report = {
            pendingManagerApproval: [],
            pendingHRApproval: []
        };

        for (const leave of leaves) {

            const employee = employees.find(
                emp => emp.ID === leave.employee_ID
            );

            const leaveType = leaveTypes.find(
                type => type.ID === leave.leaveType_ID
            );

            if (!employee || !leaveType) {
                continue;
            }

            const data = {
                leaveRequestID: leave.ID,
                employeeId: employee.employeeId,
                employeeName: employee.name,
                leaveType: leaveType.name,
                fromDate: leave.fromDate,
                toDate: leave.toDate,
                reason: leave.reason
            };

            if (leave.status === "Pending Manager Approval") {
                report.pendingManagerApproval.push(data);
            }

            if (leave.status === "Pending HR Approval") {
                report.pendingHRApproval.push(data);
            }
        }

        return JSON.stringify(report);

    });

    // Dashboard KPIs
    this.on("dashboardKPIs", async () => {

        const employees = await SELECT.from(Employees);
        const leaves = await SELECT.from(LeaveRequests);
        const holidays = await SELECT.from(Holidays);

        const kpis = {
            totalEmployees: employees.length,
            totalLeaveRequests: leaves.length,
            approvedLeaves: 0,
            pendingManagerApproval: 0,
            pendingHRApproval: 0,
            rejectedLeaves: 0,
            withdrawnLeaves: 0,
            cancelledLeaves: 0,
            totalHolidays: holidays.length
        };

        leaves.forEach(leave => {

            switch (leave.status) {

                case "Approved":
                    kpis.approvedLeaves++;
                    break;

                case "Pending Manager Approval":
                    kpis.pendingManagerApproval++;
                    break;

                case "Pending HR Approval":
                    kpis.pendingHRApproval++;
                    break;

                case "Rejected":
                    kpis.rejectedLeaves++;
                    break;

                case "Withdrawn":
                    kpis.withdrawnLeaves++;
                    break;

                case "Cancelled":
                    kpis.cancelledLeaves++;
                    break;
            }

        });

        return JSON.stringify(kpis);

    });
});
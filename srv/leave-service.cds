using company.leave as db from '../db/schema';

service LeaveService {
    entity Employees as projection on db.Employees;
    entity LeaveRequests as projection on db.LeaveRequests;
    entity LeaveTypes as projection on db.LeaveTypes;
    entity LeaveBalances as projection on db.LeaveBalances;
    entity Departments as projection on db.Departments;
    entity Holidays as projection on db.Holidays;
    entity Notifications as projection on db.Notifications;
    entity AuditLogs as projection on db.AuditLogs;
    @requires: 'Manager'
    action managerApprove(ID : UUID) returns String;
    @requires: 'Manager'
    action managerReject(ID : UUID) returns String;
    @requires: 'HR'
    action hrApprove(ID : UUID) returns String;
    @requires: 'HR'
    action hrReject(ID : UUID) returns String;
    action withdrawLeave(ID : UUID) returns String;
    action cancelLeave(ID : UUID) returns String;
    action deactivateHoliday(ID : UUID) returns String;
    action activateHoliday(ID : UUID) returns String;
    action leaveSummary() returns String;
    @requires: 'HR'
    action departmentLeaveReport() returns String;
    @requires: 'HR'
    action leaveTypeUsageReport() returns String;
    @requires: 'HR'
    action monthlyLeaveReport() returns String;
    @requires: 'HR'
    action leaveBalanceReport() returns String;
    @requires: 'HR'
    action pendingApprovalReport() returns String;
    @requires: 'HR'
    action dashboardKPIs() returns String;
    action markNotificationRead(ID : UUID) returns String;
    action markAllNotificationsRead(employeeID : UUID) returns String;
    function remainingLeave(employeeID : UUID, leaveType :UUID) returns Integer;
    function leaveHistory(employeeID : UUID) returns many LeaveRequests;
    function totalEmployees() returns Integer;
    function employeesByManager(managerID : UUID) returns many Employees;
    function auditHistory() returns many AuditLogs;
    function employeeNotifications(employeeID : UUID) returns many Notifications;
    function unreadNotifications(employeeID : UUID) returns many Notifications;
    function unreadNotificationCount(employeeID : UUID) returns Integer;
    function filterNotifications(
    employeeID : UUID,
    type       : String,
    isRead     : Boolean
    ) returns many Notifications;
    function currentUser() returns String;
    function myEmployee() returns String;
}
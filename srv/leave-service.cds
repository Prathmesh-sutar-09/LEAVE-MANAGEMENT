using company.leave as db from '../db/schema';

service LeaveService {
    entity Employees as projection on db.Employees;
    entity LeaveRequests as projection on db.LeaveRequests;
    entity LeaveTypes as projection on db.LeaveTypes;
    entity LeaveBalances as projection on db.LeaveBalances;
    entity Departments as projection on db.Departments;
    entity Holidays as projection on db.Holidays;
    entity Notifications as projection on db.Notifications;
    action managerApprove(ID : UUID) returns String;
    action managerReject(ID : UUID) returns String;
    action hrApprove(ID : UUID) returns String;
    action hrReject(ID : UUID) returns String;
    action withdrawLeave(ID : UUID) returns String;
    action cancelLeave(ID : UUID) returns String;
    action deactivateHoliday(ID : UUID) returns String;
    action activateHoliday(ID : UUID) returns String;
    function remainingLeave(employeeID : UUID, leaveType :UUID) returns Integer;
    function leaveHistory(employeeID : UUID) returns many LeaveRequests;
    function totalEmployees() returns Integer;
    function employeesByManager(managerID : UUID) returns many Employees;
}